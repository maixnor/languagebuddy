import Redis from 'ioredis';
import { Subscriber } from './subscriber.types';
import { logger } from '../../config'; // Will be updated
import { getMissingProfileFieldsReflective, validateTimezone, ensureValidTimezone } from './subscriber.utils';
import { DateTime } from 'luxon';
import { generateRegularSystemPromptForSubscriber, generateDefaultSystemPromptForSubscriber } from './subscriber.prompts';


export class SubscriberService {
  private _getTodayInSubscriberTimezone(subscriber: Subscriber | null): string {
    const timezone = ensureValidTimezone(subscriber?.profile.timezone);
    return DateTime.now().setZone(timezone).toISODate();
  }

  /**
   * Returns true if the user can start a conversation today (throttle logic).
   * Only allows one conversation per day for non-premium users after trial.
   * 
   * @deprecated Use attemptToStartConversation for atomic check-and-act
   */
  public async canStartConversationToday(phoneNumber: string): Promise<boolean> {
    const subscriber = await this.getSubscriber(phoneNumber);
    if (subscriber && subscriber.isPremium) {
      return true; // Premium users can always start a conversation
    }

    const today = this._getTodayInSubscriberTimezone(subscriber); // Use helper

    const key = `conversation_count:${phoneNumber}:${today}`;
    const count = await this.redis.get(key);
    return !count || parseInt(count) < 1;
  }

  /**
   * Atomically checks if the user can start a conversation and increments the count if allowed.
   * Returns true if conversation is allowed (and count was incremented).
   */
  public async attemptToStartConversation(phoneNumber: string): Promise<boolean> {
    const subscriber = await this.getSubscriber(phoneNumber);
    
    // Always allow premium users, but we still might want to track their usage.
    if (subscriber && subscriber.isPremium) {
      await this.incrementConversationCount(phoneNumber);
      return true;
    }

    const today = this._getTodayInSubscriberTimezone(subscriber);
    const key = `conversation_count:${phoneNumber}:${today}`;
    const ttl = 86400;
    const limit = 1;

    // Atomic check-and-increment using Lua
    // Returns 1 if allowed (incremented), 0 if denied
    const result = await this.redis.eval(`
      local count = redis.call("GET", KEYS[1])
      if not count or tonumber(count) < tonumber(ARGV[2]) then
         local new_count = redis.call("INCR", KEYS[1])
         if new_count == 1 or redis.call("TTL", KEYS[1]) == -1 then
            redis.call("EXPIRE", KEYS[1], ARGV[1])
         end
         return 1
      else
         return 0
      end
    `, 1, key, ttl, limit);
    
    return result === 1;
  }

  /**
   * Increments the daily conversation count for the user.
   * Uses atomic Lua script to ensure TTL is set correctly.
   */
  public async incrementConversationCount(phoneNumber: string): Promise<void> {
    const subscriber = await this.getSubscriber(phoneNumber); // Get subscriber to access timezone
    const today = this._getTodayInSubscriberTimezone(subscriber); // Use helper
    const key = `conversation_count:${phoneNumber}:${today}`;
    const ttl = 86400;

    // Atomic INCR + EXPIRE using Lua
    await this.redis.eval(`
      local count = redis.call("INCR", KEYS[1])
      if count == 1 or redis.call("TTL", KEYS[1]) == -1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
      end
      return count
    `, 1, key, ttl);
  }
  private static instance: SubscriberService;
  private redis: Redis;

  /**
   * Returns the number of days since the user signed up.
   */
  public getDaysSinceSignup(subscriber: Subscriber): number {
    // Ensure signedUpAt is a valid Date object
    if (!subscriber.signedUpAt) {
        subscriber.signedUpAt = new Date();
        this.saveSubscriber(subscriber).catch(err => logger.error({ err }, "Error caching subscriber after setting signedUpAt"));
    } else if (!(subscriber.signedUpAt instanceof Date)) {
        // Try to parse string (e.g. ISO string from Redis/JSON)
        const parsed = new Date(subscriber.signedUpAt);
        if (!isNaN(parsed.getTime())) {
            subscriber.signedUpAt = parsed;
        } else {
             logger.warn({ invalidDate: subscriber.signedUpAt, phone: subscriber.connections.phone }, "Invalid signedUpAt date string, resetting to now");
             subscriber.signedUpAt = new Date();
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
    return Math.floor(nowInUserTimezone.diff(signedUpInUserTimezone, 'days').days);
  }

  /**
   * Returns true if the user should see a subscription warning (days 3-6, not premium).
   */
  public shouldShowSubscriptionWarning(subscriber: Subscriber): boolean {
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days >= 3 && days < 7;
  }

  /**
   * Returns true if the user should be throttled (after day 7, not premium).
   */
  public shouldThrottle(subscriber: Subscriber): boolean {
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days > 7;
  }

  /**
   * Returns true if the user should be prompted to subscribe (after day 7, not premium).
   */
  public shouldPromptForSubscription(subscriber: Subscriber): boolean {
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days > 7;
  }

  private constructor(redis: Redis) {
    this.redis = redis;
  }

  static getInstance(redis?: Redis): SubscriberService {
    if (!SubscriberService.instance) {
      if (!redis) {
        throw new Error("Redis instance required for first initialization");
      }
      SubscriberService.instance = new SubscriberService(redis);
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
      const cachedSubscriber = await this.redis.get(`subscriber:${phoneNumber}`);
      if (cachedSubscriber) {
        const subscriber = JSON.parse(cachedSubscriber);
        this.hydrateSubscriber(subscriber);
        subscriber.lastActiveAt = new Date();
        return subscriber;
      }
      return null;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting subscriber");
      return null;
    }
  }

  async createSubscriber(phoneNumber: string, initialData?: Partial<Subscriber>): Promise<Subscriber> {
    const subscriber: Subscriber = {
      connections: {
        phone: phoneNumber,
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
      ...initialData
    };

    // Validate timezone in initialData if present
    if (subscriber.profile.timezone) {
      const validatedTz = validateTimezone(subscriber.profile.timezone);
      subscriber.profile.timezone = validatedTz || undefined;
    }

    // Check if profile is missing required fields (reflection-based)
    const missingFields = getMissingProfileFieldsReflective(subscriber.profile!);
    if (missingFields.length > 0) {
      logger.info({ missingFields, phoneNumber }, "Subscriber created with missing profile fields");
    }

    await this.saveSubscriber(subscriber);
    logger.info({ phoneNumber }, "New subscriber created");
    return subscriber;
  }

  async updateSubscriber(phoneNumber: string, updates: Partial<Subscriber>): Promise<void> {
    try {
      let subscriber = await this.getSubscriber(phoneNumber);
      if (!subscriber) {
        subscriber = await this.createSubscriber(phoneNumber);
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
        logger.info({ missingFields, phoneNumber }, "Subscriber updated with missing profile fields");
      }

      logger.trace({phoneNumber, updates}, `Updated user with this info:`)
    } catch (error) {
      logger.error({ error, phoneNumber, updates }, "Error updating subscriber");
      throw error;
    }
  }

  async getAllSubscribers(): Promise<Subscriber[]> {
    try {
      const keys = await this.redis.keys('subscriber:*');
      if (keys.length === 0) {
        return [];
      }

      const subscribers: Subscriber[] = [];
      for (const key of keys) {
        const cachedSubscriber = await this.redis.get(key);
        if (cachedSubscriber) {
          const subscriber = JSON.parse(cachedSubscriber);
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
      await this.redis.set(
        `subscriber:${subscriber.connections.phone}`,
        JSON.stringify(subscriber)
      );
    } catch (error) {
      logger.error({ err: error, phone: subscriber.connections.phone }, "Error caching subscriber");
      throw error; // Re-throw the error to prevent silent failures
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

    prompt += `\n\nTASK: INITIATE NEW DAY CONVERSATION
    - This is a fresh start after a nightly reset.
    - Initiate a conversation naturally.
    - If there's a topic from the last digest, you might reference it or start something new.
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
