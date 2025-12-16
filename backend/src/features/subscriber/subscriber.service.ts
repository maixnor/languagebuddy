import { DatabaseService } from '../../core/database';
import { Subscriber } from './subscriber.types';
import { logger, config } from '../../core/config';
import { getMissingProfileFieldsReflective, validateTimezone, ensureValidTimezone, isTestPhoneNumber, sanitizePhoneNumber } from './subscriber.utils';
import { DateTime } from 'luxon';
import { generateRegularSystemPromptForSubscriber, generateDefaultSystemPromptForSubscriber } from './subscriber.prompts';
import { recordNewSubscriber } from '../../core/observability/metrics';


export class SubscriberService {  private static instance: SubscriberService; // Declare the static instance property
  private _getTodayInSubscriberTimezone(subscriber: Subscriber | null): string {
    const timezone = ensureValidTimezone(subscriber?.profile.timezone);
    return DateTime.now().setZone(timezone).toISODate();
  }


  /**
   * Returns the number of days since the user signed up.
   */
  public getDaysSinceSignup(subscriber: Subscriber): number {
    // Ensure signedUpAt is a valid Date object
    if (!subscriber.signedUpAt) {
        subscriber.signedUpAt = new Date();
        if (!subscriber.status) { subscriber.status = "active"; }
        this.saveSubscriber(subscriber).catch(err => logger.error({ err }, "Error caching subscriber after setting signedUpAt"));
    } else if (!(subscriber.signedUpAt instanceof Date)) {
        // Try to parse string (e.g. ISO string from Redis/JSON)
        const parsed = new Date(subscriber.signedUpAt);
        if (!isNaN(parsed.getTime())) {
            subscriber.signedUpAt = parsed;
        } else {
             logger.warn({ invalidDate: subscriber.signedUpAt, phone: subscriber.connections.phone }, "Invalid signedUpAt date string, resetting to now");
             subscriber.signedUpAt = new Date();
             if (!subscriber.status) { subscriber.status = "active"; }
             this.saveSubscriber(subscriber).catch(err => logger.error({ err }, "Error caching subscriber after resetting invalid signedUpAt"));
        }
    }
    
    const timezone = ensureValidTimezone(subscriber.profile.timezone);

    // Parse signedUpAt and set its zone to the user's timezone
    // @ts-ignore - Luxon handles Dates, but to be safe we use fromJSDate if it is a date
    const signedUpInUserTimezone = DateTime.fromJSDate(subscriber.signedUpAt).setZone(timezone);

    // Get the current time in the user's timezone
    const nowInUserTimezone = DateTime.now().setZone(timezone);

    // Calculate the difference in full days based on 24-hour periods
    return Math.floor(nowInUserTimezone.diff(signedUpInUserTimezone, 'days').toObject().days || 0);
  }

  /**
   * Returns true if the user should see a subscription warning (days 6-7, not premium).
   * Note: "Day 6 and 7" corresponds to indices 5 and 6 (since day 1 is index 0).
   */
  public shouldShowSubscriptionWarning(subscriber: Subscriber): boolean {
    // If stripe check is skipped or it's a test phone number, never show warning
    if (config.test.skipStripeCheck || isTestPhoneNumber(subscriber.connections.phone) || config.test.phoneNumbers.includes(subscriber.connections.phone)) {
        return false;
    }
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days >= 5 && days < 7;
  }

  /**
   * Returns true if the user should be throttled (after day 7, not premium).
   * Note: "After 7 days" corresponds to index 7 and above.
   */
  public shouldThrottle(subscriber: Subscriber): boolean {
    // If stripe check is skipped or it's a test phone number, never throttle
    if (config.test.skipStripeCheck || isTestPhoneNumber(subscriber.connections.phone) || config.test.phoneNumbers.includes(subscriber.connections.phone)) {
        return false;
    }
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days >= 7;
  }

  /**
   * Returns true if the user should be prompted to subscribe (after day 7, not premium).
   */
  public shouldPromptForSubscription(subscriber: Subscriber): boolean {
    // If stripe check is skipped or it's a test phone number, never prompt for subscription
    if (config.test.skipStripeCheck || isTestPhoneNumber(subscriber.connections.phone) || config.test.phoneNumbers.includes(subscriber.connections.phone)) {
        return false;
    }
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days >= 7;
  }

  private dbService: DatabaseService;

  private constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  static getInstance(dbService?: DatabaseService): SubscriberService {
    if (!SubscriberService.instance) {
      if (!dbService) {
        throw new Error("DatabaseService instance required for first initialization");
      }
      SubscriberService.instance = new SubscriberService(dbService);
    }
    return SubscriberService.instance;
  }

  public hydrateSubscriber(subscriber: any): Subscriber {
    const toDate = (val: any) => (val ? new Date(val) : undefined);

    if (subscriber.signedUpAt) subscriber.signedUpAt = toDate(subscriber.signedUpAt);
    if (subscriber.lastActiveAt) subscriber.lastActiveAt = toDate(subscriber.lastActiveAt);
    if (subscriber.nextPushMessageAt) subscriber.nextPushMessageAt = toDate(subscriber.nextPushMessageAt);
    if (subscriber.metadata?.lastNightlyDigestRun) {
      subscriber.metadata.lastNightlyDigestRun = toDate(subscriber.metadata.lastNightlyDigestRun);
    }

    const hydrateLanguages = (languages: any[]) => {
      if (!languages) return;
      languages.forEach(lang => {
        if (lang.firstEncountered) lang.firstEncountered = toDate(lang.firstEncountered);
        if (lang.lastPracticed) lang.lastPracticed = toDate(lang.lastPracticed);
        
        if (lang.skillAssessments) {
          lang.skillAssessments.forEach((sa: any) => {
            if (sa.lastAssessed) sa.lastAssessed = toDate(sa.lastAssessed);
          });
        }

        if (lang.deficiencies) {
          lang.deficiencies.forEach((def: any) => {
             if (def.firstDetected) def.firstDetected = toDate(def.firstDetected);
             if (def.lastOccurrence) def.lastOccurrence = toDate(def.lastOccurrence);
             if (def.lastPracticedAt) def.lastPracticedAt = toDate(def.lastPracticedAt);
          });
        }
      });
    };

    hydrateLanguages(subscriber.profile.speakingLanguages);
    hydrateLanguages(subscriber.profile.learningLanguages);

    return subscriber as Subscriber;
  }

  async getSubscriber(phoneNumber: string): Promise<Subscriber | null> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      const stmt = this.dbService.getDb().prepare('SELECT phone_number, status, created_at, last_active_at, data FROM subscribers WHERE phone_number = ?');
      const row = stmt.get(sanitizedPhone) as { phone_number: string, status: string, created_at: string, last_active_at: string | null, data: string } | undefined;

      if (row) {
        const subscriberPartial = JSON.parse(row.data);
        const subscriber: Subscriber = {
          ...subscriberPartial,
          connections: {
            ...subscriberPartial.connections,
            phone: row.phone_number, // Ensure the phone number from the column is used
          },
          status: row.status,
          signedUpAt: row.created_at ? new Date(row.created_at) : undefined,
          lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : undefined,
        };
        this.hydrateSubscriber(subscriber);
        return subscriber;
      }
      return null;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting subscriber");
      return null;
    }
  }

  async createSubscriber(phoneNumber: string, initialData?: Partial<Subscriber>): Promise<Subscriber> {
    const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
    const subscriber: Subscriber = {
      connections: {
        phone: sanitizedPhone,
      },
      profile: {
        name: "New User",
        speakingLanguages: [],
        learningLanguages: [],
      },
      signedUpAt: new Date(),
      metadata: {
        digests: [],
        personality: "A friendly language buddy talking about everything",
        streakData: {
          currentStreak: 0,
          longestStreak: 0,
          lastIncrement: new Date(),
        },
        predictedChurnRisk: 0,
        engagementScore: 0,
        mistakeTolerance: "normal"
      },
      isPremium: false,
      lastActiveAt: new Date(),
      nextPushMessageAt: DateTime.now().plus({ hours: 24 }).toUTC().toJSDate(),
      isTestUser: isTestPhoneNumber(sanitizedPhone) || config.test.phoneNumbers.includes(sanitizedPhone), // Set test user flag
      status: "onboarding", // Initialize status explicitly
      ...initialData
    };



    // If initialData explicitly sets isPremium, respect it.
    // Otherwise, apply test-specific overrides.
    if (initialData?.isPremium !== undefined) {
      subscriber.isPremium = initialData.isPremium;
    } else if (config.test.skipStripeCheck || subscriber.isTestUser) {
      subscriber.isPremium = true;
      logger.info({ phoneNumber: sanitizedPhone }, "Subscriber created as premium due to test configuration or being a test user.");
    }

    // Validate timezone in initialData if present
    if (subscriber.profile.timezone) {
      const validatedTz = validateTimezone(subscriber.profile.timezone);
      subscriber.profile.timezone = validatedTz || undefined;
    }

    // Check if profile is missing required fields (reflection-based)
    const missingFields = getMissingProfileFieldsReflective(subscriber.profile!);
    if (missingFields.length > 0) {
      logger.info({ missingFields, phoneNumber: sanitizedPhone }, "Subscriber created with missing profile fields");
    }

    await this.saveSubscriber(subscriber);
    logger.info({ phoneNumber: sanitizedPhone }, "New subscriber created");
    recordNewSubscriber();
    return subscriber;
  }

  async updateSubscriber(phoneNumber: string, updates: Partial<Subscriber>): Promise<void> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      let subscriber = await this.getSubscriber(sanitizedPhone);
      if (!subscriber) {
        subscriber = await this.createSubscriber(sanitizedPhone);
      }

      // Validate timezone if it's being updated
      if (updates.profile && updates.profile.timezone) {
        const validatedTz = validateTimezone(updates.profile.timezone);
        updates.profile.timezone = validatedTz || undefined;
      }

      Object.assign(subscriber, updates);
      subscriber.lastActiveAt = new Date();
      await this.saveSubscriber(subscriber);

      // Re-check missing fields after update (reflection-based)
      const missingFields = getMissingProfileFieldsReflective(subscriber.profile);
      if (missingFields.length > 0) {
        logger.info({ missingFields, phoneNumber: sanitizedPhone }, "Subscriber updated with missing profile fields");
      }

      logger.trace({phoneNumber: sanitizedPhone, updates}, `Updated user with this info:`)
    } catch (error) {
      logger.error({ error, phoneNumber, updates }, "Error updating subscriber");
      throw error;
    }
  }

  async deleteSubscriber(phoneNumber: string): Promise<boolean> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      const stmt = this.dbService.getDb().prepare('DELETE FROM subscribers WHERE phone_number = ?');
      const result = stmt.run(sanitizedPhone);
      
      const success = result.changes > 0;
      if (success) {
        logger.info({ phoneNumber: sanitizedPhone }, "Subscriber deleted successfully");
      } else {
        logger.warn({ phoneNumber: sanitizedPhone }, "Attempted to delete non-existent subscriber");
      }
      return success;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error deleting subscriber");
      throw error;
    }
  }

  async getAllSubscribers(): Promise<Subscriber[]> {
    try {
      const stmt = this.dbService.getDb().prepare('SELECT data FROM subscribers');
      const rows = stmt.all() as { data: string }[];

      const subscribers: Subscriber[] = [];
      for (const row of rows) {
        if (row && row.data) {
          const subscriber = JSON.parse(row.data);
          this.hydrateSubscriber(subscriber);
          subscribers.push(subscriber);
        }
      }

      logger.trace({ count: subscribers.length }, "Retrieved all subscribers");
      return subscribers;
    } catch (error) {
      logger.error({ err: error }, "Error getting all subscribers");
      return [];
    }
  }

  private async saveSubscriber(subscriber: Subscriber): Promise<void> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(subscriber.connections.phone);
      subscriber.connections.phone = sanitizedPhone; // Ensure the object itself has the sanitized phone number

      const status = subscriber.status;
      // Ensure signedUpAt is a Date object before converting to ISO string
      let signedUpAtDate: Date | undefined;
      if (subscriber.signedUpAt instanceof Date) {
        signedUpAtDate = subscriber.signedUpAt;
      } else if (typeof subscriber.signedUpAt === 'string') {
        const parsedDate = new Date(subscriber.signedUpAt);
        if (!isNaN(parsedDate.getTime())) {
          signedUpAtDate = parsedDate;
        }
      }
      const createdAtISO = signedUpAtDate ? signedUpAtDate.toISOString() : new Date().toISOString();

      const lastActiveAt = subscriber.lastActiveAt;
      const lastActiveAtISO = (lastActiveAt instanceof Date && !isNaN(lastActiveAt.getTime())) ? lastActiveAt.toISOString() : null;

      const rest: Partial<Subscriber> = { ...subscriber };
      delete rest.status;
      delete rest.signedUpAt;
      delete rest.lastActiveAt;
      const data = JSON.stringify(rest);

      const stmt = this.dbService.getDb().prepare(`
        INSERT OR REPLACE INTO subscribers (phone_number, status, created_at, last_active_at, data)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(sanitizedPhone, status, createdAtISO, lastActiveAtISO, data);
    } catch (error) {
      logger.error({ err: error, phone: subscriber.connections.phone }, "Error saving subscriber");
      throw error;
    }
  }

  public async createDigest(subscriber: Subscriber): Promise<boolean> {
    try {
      const DigestService = await import('../digest/digest.service'); // Will be updated
      const digestService = DigestService.DigestService.getInstance();
      
      // Create the digest
      const digest = await digestService.createConversationDigest(subscriber);
      if (!digest) {
        logger.info({ phone: subscriber.connections.phone }, "No conversation history available for digest creation");
        return false;
      }
      await digestService.saveDigestToSubscriber(subscriber, digest);
      
      logger.info({ phone: subscriber.connections.phone }, "Digest created successfully");
      return true;
    } catch (error) {
      logger.error({ err: error, phone: subscriber.connections.phone }, "Error creating digest");
      throw error;
    }
  }

  public async incrementMessageCount(phoneNumber: string): Promise<void> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      const stmt = this.dbService.getDb().prepare(`
        INSERT INTO daily_usage (phone_number, usage_date, message_count)
        VALUES (?, date('now'), 1)
        ON CONFLICT(phone_number, usage_date) DO UPDATE SET message_count = message_count + 1
      `);
      stmt.run(sanitizedPhone);
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error incrementing message count");
      throw error;
    }
  }

  public async getMessageCount(phoneNumber: string): Promise<number> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      const stmt = this.dbService.getDb().prepare(`
        SELECT message_count FROM daily_usage WHERE phone_number = ? AND usage_date = date('now')
      `);
      const row = stmt.get(sanitizedPhone) as { message_count: number } | undefined;
      return row?.message_count || 0;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting message count");
      return 0;
    }
  }

  public async canStartConversationToday(phoneNumber: string, nowDate?: string): Promise<boolean> {
    const subscriber = await this.getSubscriber(phoneNumber);
    const isBypassed = config.test.skipStripeCheck || subscriber?.isPremium || (subscriber && isTestPhoneNumber(subscriber.connections.phone)) || config.test.phoneNumbers.includes(phoneNumber);

    if (isBypassed) {
        return true;
    }

    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      let usageDate = nowDate;

      if (!usageDate) {
        if (subscriber && subscriber.profile.timezone) {
           usageDate = DateTime.now().setZone(subscriber.profile.timezone).toISODate();
        } else {
           // Fallback if no subscriber or timezone found (shouldn't happen for active users)
           usageDate = DateTime.now().toUTC().toISODate(); 
        }
      }

      const stmt = this.dbService.getDb().prepare(`
        SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?
      `);
      const row = stmt.get(sanitizedPhone, usageDate) as { conversation_start_count: number } | undefined;
      return (row?.conversation_start_count || 0) === 0;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error checking if conversation can be started today");
      return false;
    }
  }

  public async incrementConversationCount(phoneNumber: string, nowDate?: string): Promise<void> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      let usageDate = nowDate;

      if (!usageDate) {
        const subscriber = await this.getSubscriber(sanitizedPhone);
        const timezone = ensureValidTimezone(subscriber?.profile.timezone);
        usageDate = DateTime.now().setZone(timezone).toISODate();
      }

      const stmt = this.dbService.getDb().prepare(`
        INSERT INTO daily_usage (phone_number, usage_date, conversation_start_count)
        VALUES (?, ?, 1)
        ON CONFLICT(phone_number, usage_date) DO UPDATE SET conversation_start_count = conversation_start_count + 1
      `);
      stmt.run(sanitizedPhone, usageDate);
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error incrementing conversation count");
      throw error;
    }
  }

  public async attemptToStartConversation(phoneNumber: string): Promise<boolean> {
    const subscriber = await this.getSubscriber(phoneNumber);
    const isBypassedUser = config.test.skipStripeCheck || (subscriber && isTestPhoneNumber(subscriber.connections.phone)) || config.test.phoneNumbers.includes(phoneNumber);

    const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
    const timezone = ensureValidTimezone(subscriber?.profile.timezone);
    const today = DateTime.now().setZone(timezone).toISODate();

    if (isBypassedUser) {
        // For bypassed users, we always increment
        await this.incrementConversationCount(phoneNumber, today);
        return true;
    }

    try {
      // Atomic check-and-increment:
      // Try to insert with count=1.
      // If conflict (row exists), try to increment ONLY IF count is 0.
      // If count is > 0, the WHERE clause fails, and changes will be 0.
      const stmt = this.dbService.getDb().prepare(`
        INSERT INTO daily_usage (phone_number, usage_date, conversation_start_count)
        VALUES (?, ?, 1)
        ON CONFLICT(phone_number, usage_date) 
        DO UPDATE SET conversation_start_count = conversation_start_count + 1
        WHERE conversation_start_count = 0
      `);
      const result = stmt.run(sanitizedPhone, today);
      return result.changes > 0;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error attempting to start conversation");
      return false;
    }
  }

  public getDailySystemPrompt(subscriber: Subscriber): string {
    const targetLanguage = subscriber.profile.learningLanguages?.[0] || {
      languageName: 'English',
      overallLevel: 'A1',
      skillAssessments: [],
      deficiencies: [],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 0,
      currentLanguage: true,
    };

    let prompt = generateRegularSystemPromptForSubscriber(subscriber, targetLanguage);

    prompt += `

TASK: INITIATE NEW DAY CONVERSATION
    - This is a fresh start after a nightly reset.
    - Initiate a conversation naturally.
    - If there's a topic from the last digest, you might reference it or start something new.
    - CRITICAL: Check the "RECENT CONVERSATION HISTORY" section for "YOUR PREVIOUS MISTAKES". If any are listed, you MUST apologize for them and correct them in your first message.
    - Don't ask "Do you want to practice?". Just start talking.
    - Disguise your conversation starters as trying to find out more information about the user if appropriate.
    `;
    return prompt;
  }

  public getDefaultSystemPrompt(subscriber: Subscriber): string {
    return generateDefaultSystemPromptForSubscriber(subscriber);
  }

  public async setLanguage(phoneNumber: string, languageCode: string): Promise<void> {
    try {
      const subscriber = await this.getSubscriber(phoneNumber);
      if (!subscriber) {
        throw new Error(`Subscriber with phone ${phoneNumber} not found`);
      }

      // 1. Manage the learningLanguages array
      let languageFound = false;
      if (!subscriber.profile.learningLanguages) {
        subscriber.profile.learningLanguages = [];
      }

      const normalizedLanguageCode = languageCode.toLowerCase();

      subscriber.profile.learningLanguages = subscriber.profile.learningLanguages.map(lang => {
        if (lang.languageName.toLowerCase() === normalizedLanguageCode) {
          languageFound = true;
          return { ...lang, currentLanguage: true };
        }
        return { ...lang, currentLanguage: false };
      });

      if (!languageFound) {
        // Add new language if not found
        subscriber.profile.learningLanguages.push({
          languageName: languageCode.charAt(0).toUpperCase() + languageCode.slice(1).toLowerCase(), // Capitalize first letter
          overallLevel: "A1", // Default level for new language
          skillAssessments: [],
          deficiencies: [],
          firstEncountered: new Date(),
          lastPracticed: new Date(),
          totalPracticeTime: 0,
          confidenceScore: 0,
          currentLanguage: true,
        });
      }

      await this.saveSubscriber(subscriber);
      logger.info({ phoneNumber, languageCode }, `Subscriber ${phoneNumber} learning language set to ${languageCode}`);
    } catch (error) {
      logger.error({ err: error, phoneNumber, languageCode }, "Error setting subscriber language");
      throw error;
    }
  }

  async addLanguageDeficiencyToSubscriber(
    phoneNumber: string, 
    languageName: string, 
    deficiency: Omit<import('./subscriber.types').LanguageDeficiency, 'firstDetected' | 'lastOccurrence'>
  ): Promise<void> {
    try {
      const subscriber = await this.getSubscriber(phoneNumber);
      if (!subscriber) {
        throw new Error(`Subscriber with phone ${phoneNumber} not found`);
      }

      // Find the language in speaking or learning languages
      let targetLanguage = subscriber.profile.learningLanguages?.find(lang => lang.languageName === languageName);

      if (!targetLanguage) {
        throw new Error(`Language ${languageName} not found in subscriber's profile`);
      }

      // Create the complete deficiency object
      const completeDeficiency = {
        ...deficiency,
        firstDetected: new Date(),
        lastOccurrence: new Date()
      };

      // Add the deficiency
      targetLanguage.deficiencies.push(completeDeficiency);

      // Update the subscriber
      await this.saveSubscriber(subscriber);
      logger.info({ phoneNumber, languageName, deficiency: completeDeficiency }, "Added language deficiency to subscriber");
    } catch (error) {
      logger.error({ err: error, phoneNumber, languageName, deficiency }, "Error adding language deficiency");
      throw error;
    }
  }
}