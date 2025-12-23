import { DatabaseService } from '../../core/database';
import { Subscriber, Language } from './subscriber.types';
import { logger, config } from '../../core/config';
import { getMissingProfileFieldsReflective, validateTimezone, ensureValidTimezone, isTestPhoneNumber, sanitizePhoneNumber } from './subscriber.utils';
import { DateTime } from 'luxon';
import { generateRegularSystemPromptForSubscriber, generateDefaultSystemPromptForSubscriber } from './subscriber.prompts';
import { recordNewSubscriber } from '../../core/observability/metrics';


export class SubscriberService {
  private static instance: SubscriberService;
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

  private _getTodayInSubscriberTimezone(subscriber: Subscriber | null): string {
    const timezone = ensureValidTimezone(subscriber?.profile.timezone);
    return DateTime.now().setZone(timezone).toISODate();
  }

  /**
   * Returns the number of days since the user signed up.
   */
  public getDaysSinceSignup(subscriber: Subscriber): number {
    if (!subscriber.signedUpAt) {
        subscriber.signedUpAt = new Date();
        if (!subscriber.status) { subscriber.status = "active"; }
        this.saveSubscriber(subscriber).catch(err => logger.error({ err }, "Error caching subscriber after setting signedUpAt"));
    } else if (!(subscriber.signedUpAt instanceof Date)) {
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
    const signedUpInUserTimezone = DateTime.fromJSDate(subscriber.signedUpAt).setZone(timezone);
    const nowInUserTimezone = DateTime.now().setZone(timezone);

    return Math.floor(nowInUserTimezone.diff(signedUpInUserTimezone, 'days').toObject().days || 0);
  }

  public async getTotalSubscribersCount(): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare('SELECT COUNT(*) as count FROM subscribers');
      const row = stmt.get() as { count: number };
      return row.count;
    } catch (error) {
      logger.error({ err: error }, "Error getting total subscribers count");
      return 0;
    }
  }

  public async getPremiumSubscribersCount(): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare("SELECT COUNT(*) as count FROM subscribers WHERE is_premium = 1");
      const row = stmt.get() as { count: number };
      return row.count;
    } catch (error) {
      logger.error({ err: error }, "Error getting premium subscribers count");
      return 0;
    }
  }

  public async getActiveSubscribers24hCount(): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT COUNT(*) as count 
        FROM subscribers 
        WHERE last_active_at IS NOT NULL 
          AND datetime(last_active_at) >= datetime('now', '-24 hours')
      `);
      const row = stmt.get() as { count: number };
      return row.count;
    } catch (error) {
      return 0;
    }
  }

  public async getActiveConversationsCount(): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT COUNT(*) as count
        FROM subscribers
        WHERE json_extract(data, '$.lastMessageSentAt') IS NOT NULL
          AND (
            last_nightly_digest_run IS NULL
            OR
            datetime(json_extract(data, '$.lastMessageSentAt')) > datetime(last_nightly_digest_run)
          )
      `);
      const row = stmt.get() as { count: number };
      return row.count;
    } catch (error) {
      logger.error({ err: error }, "Error getting active conversations count");
      return 0;
    }
  }

  public shouldShowSubscriptionWarning(subscriber: Subscriber): boolean {
    if (config.test.skipStripeCheck || isTestPhoneNumber(subscriber.connections.phone) || config.test.phoneNumbers.includes(subscriber.connections.phone)) {
        return false;
    }
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days >= 5 && days < 7;
  }

  public shouldThrottle(subscriber: Subscriber): boolean {
    if (config.test.skipStripeCheck || isTestPhoneNumber(subscriber.connections.phone) || config.test.phoneNumbers.includes(subscriber.connections.phone)) {
        return false;
    }
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days >= 7;
  }

  public shouldPromptForSubscription(subscriber: Subscriber): boolean {
    if (config.test.skipStripeCheck || isTestPhoneNumber(subscriber.connections.phone) || config.test.phoneNumbers.includes(subscriber.connections.phone)) {
        return false;
    }
    const days = this.getDaysSinceSignup(subscriber);
    return !subscriber.isPremium && days >= 7;
  }

  public hydrateSubscriber(subscriber: any): Subscriber {
    const toDate = (val: any) => (val ? new Date(val) : undefined);

    if (subscriber.signedUpAt) subscriber.signedUpAt = toDate(subscriber.signedUpAt);
    if (subscriber.lastActiveAt) subscriber.lastActiveAt = toDate(subscriber.lastActiveAt);
    if (subscriber.nextPushMessageAt) subscriber.nextPushMessageAt = toDate(subscriber.nextPushMessageAt);
    if (subscriber.lastMessageSentAt) subscriber.lastMessageSentAt = toDate(subscriber.lastMessageSentAt);
    if (subscriber.metadata?.lastNightlyDigestRun) {
      subscriber.metadata.lastNightlyDigestRun = toDate(subscriber.metadata.lastNightlyDigestRun);
    }
    if (subscriber.metadata?.streakData?.lastIncrement) {
      subscriber.metadata.streakData.lastIncrement = toDate(subscriber.metadata.streakData.lastIncrement);
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

  async getSubscriberByTelegramChatId(chatId: number): Promise<Subscriber | null> {
    try {
      // Query using JSON extraction to find the subscriber with the matching telegram chatId
      const stmt = this.dbService.getDb().prepare(`
        SELECT phone_number 
        FROM subscribers 
        WHERE json_extract(data, '$.connections.telegram.chatId') = ?
      `);
      
      const row = stmt.get(chatId) as { phone_number: string } | undefined;

      if (!row) return null;

      return await this.getSubscriber(row.phone_number);
    } catch (error) {
      logger.error({ err: error, chatId }, "Error getting subscriber by Telegram Chat ID");
      return null;
    }
  }

  async getSubscriberByStripeCustomerId(customerId: string): Promise<Subscriber | null> {
    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT phone_number 
        FROM subscribers 
        WHERE stripe_customer_id = ?
      `);
      
      const row = stmt.get(customerId) as { phone_number: string } | undefined;

      if (!row) return null;

      return await this.getSubscriber(row.phone_number);
    } catch (error) {
      logger.error({ err: error, customerId }, "Error getting subscriber by Stripe Customer ID");
      return null;
    }
  }

  async getSubscriber(phoneNumber: string): Promise<Subscriber | null> {
    try {
      const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
      
      const stmt = this.dbService.getDb().prepare(`
        SELECT 
          phone_number, status, created_at, last_active_at, data,
          name, timezone, is_premium, is_test_user, last_nightly_digest_run,
          streak_current, streak_longest, streak_last_increment, stripe_customer_id
        FROM subscribers 
        WHERE phone_number = ?
      `);
      const row = stmt.get(sanitizedPhone) as any;

      if (!row) return null;

      // Fetch languages
      const langStmt = this.dbService.getDb().prepare(`
        SELECT language_name, type, level, confidence_score, data
        FROM subscriber_languages
        WHERE subscriber_phone = ?
      `);
      const languages = langStmt.all(sanitizedPhone) as any[];

      const speakingLanguages = languages
        .filter(l => l.type === 'speaking')
        .map(l => {
             const data = JSON.parse(l.data);
             return data; 
        });

      const learningLanguages = languages
        .filter(l => l.type === 'learning')
        .map(l => {
             const data = JSON.parse(l.data);
             return data;
        });

      // Fetch digests (Updated with normalized schema)
      const digestStmt = this.dbService.getDb().prepare(`
        SELECT 
          id, timestamp, topic, summary, 
          vocabulary_json, phrases_json, grammar_json, user_memos_json,
          metric_messages_exchanged, metric_avg_response_time, metric_avg_msg_length,
          metric_sentence_complexity, metric_punctuation_accuracy, metric_capitalization_accuracy,
          metric_text_coherence_score, metric_emoji_usage, metric_user_initiated_topics,
          metric_topics_json, metric_abbreviations_json
        FROM digests
        WHERE subscriber_phone = ?
        ORDER BY timestamp ASC
      `);
      const digestRows = digestStmt.all(sanitizedPhone) as any[];

      // Fetch mistakes for each digest (could be optimized with a join, but N+1 is acceptable for small user digest history)
      const mistakesStmt = this.dbService.getDb().prepare(`
        SELECT original_text, correction, reason
        FROM digest_assistant_mistakes
        WHERE digest_id = ?
      `);

      const digests = digestRows.map(d => {
        const assistantMistakes = mistakesStmt.all(d.id).map((m: any) => ({
            originalText: m.original_text,
            correction: m.correction,
            reason: m.reason
        }));

        return {
            timestamp: d.timestamp,
            topic: d.topic,
            summary: d.summary,
            vocabulary: JSON.parse(d.vocabulary_json),
            phrases: JSON.parse(d.phrases_json),
            grammar: JSON.parse(d.grammar_json),
            // Reconstruct the conversationMetrics object from flattened columns
            conversationMetrics: {
                messagesExchanged: d.metric_messages_exchanged,
                averageResponseTime: d.metric_avg_response_time,
                averageMessageLength: d.metric_avg_msg_length,
                sentenceComplexity: d.metric_sentence_complexity,
                punctuationAccuracy: d.metric_punctuation_accuracy,
                capitalizationAccuracy: d.metric_capitalization_accuracy,
                textCoherenceScore: d.metric_text_coherence_score,
                emojiUsage: d.metric_emoji_usage,
                userInitiatedTopics: d.metric_user_initiated_topics,
                topicsDiscussed: d.metric_topics_json ? JSON.parse(d.metric_topics_json) : [],
                abbreviationUsage: d.metric_abbreviations_json ? JSON.parse(d.metric_abbreviations_json) : []
            },
            assistantMistakes: assistantMistakes,
            userMemos: d.user_memos_json ? JSON.parse(d.user_memos_json) : []
        };
      });

      const legacyData = JSON.parse(row.data);
      
      const subscriber: Subscriber = {
        ...legacyData,
        status: row.status,
        connections: {
            ...legacyData.connections,
            phone: row.phone_number,
        },
        profile: {
            ...legacyData.profile,
            name: row.name || legacyData.profile?.name,
            timezone: row.timezone || legacyData.profile?.timezone,
            speakingLanguages,
            learningLanguages
        },
        metadata: {
            ...legacyData.metadata,
            digests,
            lastNightlyDigestRun: row.last_nightly_digest_run ? new Date(row.last_nightly_digest_run) : legacyData.metadata?.lastNightlyDigestRun,
            streakData: {
                currentStreak: row.streak_current || 0,
                longestStreak: row.streak_longest || 0,
                lastIncrement: row.streak_last_increment ? new Date(row.streak_last_increment) : legacyData.metadata?.streakData?.lastIncrement
            }
        },
        isPremium: !!row.is_premium,
        isTestUser: !!row.is_test_user,
        stripeCustomerId: row.stripe_customer_id || undefined,
        signedUpAt: row.created_at ? new Date(row.created_at) : undefined,
        lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : undefined,
      };

      this.hydrateSubscriber(subscriber);
      return subscriber;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting subscriber");
      return null;
    }
  }

  async createSubscriber(phoneNumber: string, initialData?: Partial<Subscriber>): Promise<Subscriber> {
    const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
    
    // Determine if the incoming phoneNumber is a pseudo-phone (from Telegram) or a real WhatsApp phone.
    // If initialData contains a telegram.chatId, it's a pseudo-phone.
    const isPseudoPhoneFromTelegram = initialData?.connections?.telegram?.chatId !== undefined;
    
    const connections: Subscriber["connections"] = {
      phone: sanitizedPhone,
    };

    if (initialData?.connections?.telegram) {
      connections.telegram = initialData.connections.telegram;
    }

    // If it's not a pseudo-phone from Telegram, it implies it's a WhatsApp number.
    // Also, if initialData already has a whatsapp connection (e.g., from linking), use that.
    // The explicit 'whatsapp' connection should only be set if it's a non-pseudo phone AND no existing whatsapp connection.
    if (!isPseudoPhoneFromTelegram && !initialData?.connections?.whatsapp) {
      connections.whatsapp = { phone: sanitizedPhone };
    }
    // If initialData explicitly provides a whatsapp connection, use it
    if (initialData?.connections?.whatsapp) {
      connections.whatsapp = initialData.connections.whatsapp;
    }

    const subscriber: Subscriber = {
      connections: connections,
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
      isTestUser: isTestPhoneNumber(sanitizedPhone) || config.test.phoneNumbers.includes(sanitizedPhone),
      status: "onboarding",
      ...initialData
    };

    if (initialData?.isPremium !== undefined) {
      subscriber.isPremium = initialData.isPremium;
    } else if (config.test.skipStripeCheck || subscriber.isTestUser) {
      subscriber.isPremium = true;
      logger.info({ phoneNumber: sanitizedPhone }, "Subscriber created as premium due to test configuration or being a test user.");
    }

    if (subscriber.profile.timezone) {
      const validatedTz = validateTimezone(subscriber.profile.timezone);
      subscriber.profile.timezone = validatedTz || undefined;
    }

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

      if (updates.profile && updates.profile.timezone) {
        const validatedTz = validateTimezone(updates.profile.timezone);
        updates.profile.timezone = validatedTz || undefined;
      }

      Object.assign(subscriber, updates);
      subscriber.lastActiveAt = new Date();
      await this.saveSubscriber(subscriber);

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
      const stmt = this.dbService.getDb().prepare('SELECT phone_number FROM subscribers');
      const rows = stmt.all() as { phone_number: string }[];

      const subscribers: Subscriber[] = [];
      for (const row of rows) {
        const sub = await this.getSubscriber(row.phone_number);
        if (sub) {
          subscribers.push(sub);
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
    const sanitizedPhone = sanitizePhoneNumber(subscriber.connections.phone);
    subscriber.connections.phone = sanitizedPhone;

    const status = subscriber.status;
    
    let signedUpAtDate: Date | undefined;
    if (subscriber.signedUpAt instanceof Date) {
      signedUpAtDate = subscriber.signedUpAt;
    } else if (typeof subscriber.signedUpAt === 'string') {
        const parsed = new Date(subscriber.signedUpAt);
        if (!isNaN(parsed.getTime())) signedUpAtDate = parsed;
    }
    const createdAtISO = signedUpAtDate ? signedUpAtDate.toISOString() : new Date().toISOString();

    const lastActiveAt = subscriber.lastActiveAt;
    const lastActiveAtISO = (lastActiveAt instanceof Date && !isNaN(lastActiveAt.getTime())) ? lastActiveAt.toISOString() : null;

    let lastNightlyDigestRunDate: Date | undefined;
    if (subscriber.metadata.lastNightlyDigestRun instanceof Date) {
      lastNightlyDigestRunDate = subscriber.metadata.lastNightlyDigestRun;
    } else if (typeof subscriber.metadata.lastNightlyDigestRun === 'string') {
        const parsed = new Date(subscriber.metadata.lastNightlyDigestRun);
        if (!isNaN(parsed.getTime())) lastNightlyDigestRunDate = parsed;
    }

    let lastIncrementDate: Date | undefined;
    if (subscriber.metadata.streakData?.lastIncrement instanceof Date) {
      lastIncrementDate = subscriber.metadata.streakData.lastIncrement;
    } else if (typeof subscriber.metadata.streakData?.lastIncrement === 'string') {
        const parsed = new Date(subscriber.metadata.streakData.lastIncrement);
        if (!isNaN(parsed.getTime())) lastIncrementDate = parsed;
    }

    const rest: Partial<Subscriber> = { ...subscriber };
    delete rest.status;
    delete rest.signedUpAt;
    delete rest.lastActiveAt;
    
    if (rest.profile) {
        const p = { ...rest.profile };
        delete p.name;
        delete p.timezone;
        delete p.speakingLanguages;
        delete p.learningLanguages;
        rest.profile = p;
    }
    if (rest.metadata) {
        const m = { ...rest.metadata };
        delete m.digests;
        delete m.streakData;
        delete m.lastNightlyDigestRun;
        rest.metadata = m;
    }
    delete rest.isPremium;
    delete rest.isTestUser;
    delete rest.stripeCustomerId;

    const data = JSON.stringify(rest);

    const runTransaction = this.dbService.getDb().transaction(() => {
        // 1. Update Subscribers Table
        const stmt = this.dbService.getDb().prepare(`
            INSERT OR REPLACE INTO subscribers (
                phone_number, status, created_at, last_active_at, data,
                name, timezone, is_premium, is_test_user, last_nightly_digest_run,
                streak_current, streak_longest, streak_last_increment, stripe_customer_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            sanitizedPhone,
            status,
            createdAtISO,
            lastActiveAtISO,
            data,
            subscriber.profile.name,
            subscriber.profile.timezone,
            subscriber.isPremium ? 1 : 0,
            subscriber.isTestUser ? 1 : 0,
            lastNightlyDigestRunDate ? lastNightlyDigestRunDate.toISOString() : null,
            subscriber.metadata.streakData?.currentStreak || 0,
            subscriber.metadata.streakData?.longestStreak || 0,
            lastIncrementDate ? lastIncrementDate.toISOString() : null,
            subscriber.stripeCustomerId || null
        );

        // 2. Sync Languages
        const deleteLangs = this.dbService.getDb().prepare('DELETE FROM subscriber_languages WHERE subscriber_phone = ?');
        deleteLangs.run(sanitizedPhone);

        const insertLang = this.dbService.getDb().prepare(`
            INSERT INTO subscriber_languages (subscriber_phone, language_name, type, level, confidence_score, data)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        if (subscriber.profile.learningLanguages) {
            for (const lang of subscriber.profile.learningLanguages) {
                insertLang.run(sanitizedPhone, lang.languageName, 'learning', lang.overallLevel, lang.confidenceScore, JSON.stringify(lang));
            }
        }
        if (subscriber.profile.speakingLanguages) {
            for (const lang of subscriber.profile.speakingLanguages) {
                insertLang.run(sanitizedPhone, lang.languageName, 'speaking', lang.overallLevel, lang.confidenceScore, JSON.stringify(lang));
            }
        }

        // 3. Sync Digests (Now with normalized fields)
        const deleteDigests = this.dbService.getDb().prepare('DELETE FROM digests WHERE subscriber_phone = ?');
        deleteDigests.run(sanitizedPhone);

        // Prepare Insert for Digests
        const insertDigest = this.dbService.getDb().prepare(`
            INSERT INTO digests (
                subscriber_phone, timestamp, topic, summary, 
                vocabulary_json, phrases_json, grammar_json, user_memos_json,
                metric_messages_exchanged, metric_avg_response_time, metric_avg_msg_length,
                metric_sentence_complexity, metric_punctuation_accuracy, metric_capitalization_accuracy,
                metric_text_coherence_score, metric_emoji_usage, metric_user_initiated_topics,
                metric_topics_json, metric_abbreviations_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Prepare Insert for Assistant Mistakes (child table)
        // Note: DELETE CASCADE on digests(id) means we don't need to manually delete from digest_assistant_mistakes if we delete digests,
        // but since we are doing a full replace of digests, we rely on the `deleteDigests` command which removes the digest rows, 
        // triggering CASCADE delete for mistakes.
        // Wait, DELETE FROM digests triggers cascading deletes on digest_assistant_mistakes IF foreign keys are enabled.
        // Better-sqlite3 usually enables foreign keys by default if configured, but let's be safe and verify.
        // Actually, explicit deletion is safer if FKs aren't strictly enforced.
        // But `deleteDigests` deletes by subscriber_phone. `digest_assistant_mistakes` doesn't have subscriber_phone.
        // It has digest_id.
        // So when we delete from digests, we need SQLite to cascade.
        // Let's ensure foreign keys are on. DatabaseService enables WAL, but doesn't explicitly enable FKs in constructor.
        // However, I will rely on standard behavior or just re-insert.
        // To be safe against no-FK-enforcement: I should query the digest IDs being deleted and delete mistakes for them first.
        // OR: Just execute `DELETE FROM digest_assistant_mistakes WHERE digest_id IN (SELECT id FROM digests WHERE subscriber_phone = ?)`
        const deleteMistakes = this.dbService.getDb().prepare(`
            DELETE FROM digest_assistant_mistakes 
            WHERE digest_id IN (SELECT id FROM digests WHERE subscriber_phone = ?)
        `);
        deleteMistakes.run(sanitizedPhone);
        
        const insertMistake = this.dbService.getDb().prepare(`
            INSERT INTO digest_assistant_mistakes (digest_id, original_text, correction, reason)
            VALUES (?, ?, ?, ?)
        `);

        if (subscriber.metadata.digests) {
            for (const digest of subscriber.metadata.digests) {
                const metrics = digest.conversationMetrics;
                const result = insertDigest.run(
                    sanitizedPhone,
                    digest.timestamp,
                    digest.topic,
                    digest.summary,
                    JSON.stringify(digest.vocabulary),
                    JSON.stringify(digest.phrases),
                    JSON.stringify(digest.grammar),
                    JSON.stringify(digest.userMemos || []),
                    metrics.messagesExchanged || 0,
                    metrics.averageResponseTime || 0,
                    metrics.averageMessageLength || 0,
                    metrics.sentenceComplexity || 0,
                    metrics.punctuationAccuracy || 0,
                    metrics.capitalizationAccuracy || 0,
                    metrics.textCoherenceScore || 0,
                    metrics.emojiUsage || 0,
                    metrics.userInitiatedTopics || 0,
                    JSON.stringify(metrics.topicsDiscussed || []),
                    JSON.stringify(metrics.abbreviationUsage || [])
                );
                
                const digestId = result.lastInsertRowid;

                if (digest.assistantMistakes) {
                    for (const mistake of digest.assistantMistakes) {
                        insertMistake.run(digestId, mistake.originalText, mistake.correction, mistake.reason);
                    }
                }
            }
        }
    });

    try {
        runTransaction();
    } catch (error) {
        logger.error({ err: error, phone: subscriber.connections.phone }, "Error saving subscriber (transaction)");
        throw error;
    }
  }

  public async createDigest(subscriber: Subscriber): Promise<boolean> {
    try {
      const DigestService = await import('../digest/digest.service'); // Will be updated
      const digestService = DigestService.DigestService.getInstance();
      
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
        await this.incrementConversationCount(phoneNumber, today);
        return true;
    }

    try {
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

    const daysSinceLastUserMessage = subscriber.lastMessageSentAt
        ? Math.floor(DateTime.now().startOf('day').diff(DateTime.fromJSDate(subscriber.lastMessageSentAt).startOf('day'), 'days').days)
        : 0;

    const isReEngagementDay = daysSinceLastUserMessage > 0 && daysSinceLastUserMessage % 3 === 0;

    if (isReEngagementDay) {
        prompt += `

TASK: RE-ENGAGEMENT (USER HAS BEEN INACTIVE FOR ${daysSinceLastUserMessage} DAYS)
    - The user hasn't written back in ${daysSinceLastUserMessage} days. Life gets in the way!
    - GOAL: Get a response. DO NOT focus on practice or learning today.
    - Make the conversation EASY and low-pressure.
    - Ask a simple, personal question or share something interesting to spark curiosity.
    - Avoid correcting mistakes unless they are incomprehensible.
    - Be warm and welcoming, acknowledging "life gets in the way".
    - DO NOT ask "Do you want to practice?".
    - CRITICAL: Check the "RECENT CONVERSATION HISTORY" section for "YOUR PREVIOUS MISTAKES". If any are listed, apologize for them briefly.
    `;
    } else {
        prompt += `

TASK: INITIATE NEW DAY CONVERSATION
    - This is a fresh start after a nightly reset.
    - Initiate a conversation naturally.
    - If there's a topic from the last digest, you might reference it or start something new.
    - CRITICAL: Check the "RECENT CONVERSATION HISTORY" section for "YOUR PREVIOUS MISTAKES". If any are listed, you MUST apologize for them and correct them in your first message.
    - Don't ask "Do you want to practice?". Just start talking.
    - Disguise your conversation starters as trying to find out more information about the user if appropriate.
    `;
    }
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
        subscriber.profile.learningLanguages.push({
          languageName: languageCode.charAt(0).toUpperCase() + languageCode.slice(1).toLowerCase(),
          overallLevel: "A1",
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

      let targetLanguage = subscriber.profile.learningLanguages?.find(lang => lang.languageName === languageName);

      if (!targetLanguage) {
        throw new Error(`Language ${languageName} not found in subscriber's profile`);
      }

      const completeDeficiency = {
        ...deficiency,
        firstDetected: new Date(),
        lastOccurrence: new Date()
      };

      targetLanguage.deficiencies.push(completeDeficiency);

      await this.saveSubscriber(subscriber);
      logger.info({ phoneNumber, languageName, deficiency: completeDeficiency }, "Added language deficiency to subscriber");
    } catch (error) {
      logger.error({ err: error, phoneNumber, languageName, deficiency }, "Error adding language deficiency");
      throw error;
    }
  }

  private async getSubscribersByInactivity(days: number): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT COUNT(*) as count
        FROM subscribers
        WHERE 
            datetime(COALESCE(last_active_at, created_at)) <= datetime('now', '-' || ? || ' days')
      `);
      const row = stmt.get(days) as { count: number };
      return row.count;
    } catch (error) {
      logger.error({ err: error, days }, "Error getting subscribers by inactivity");
      return 0;
    }
  }

  public async getInactiveSubscribersCount(days: number = 3): Promise<number> {
    return this.getSubscribersByInactivity(days);
  }

  public async getChurnedSubscribersCount(days: number = 7): Promise<number> {
    return this.getSubscribersByInactivity(days);
  }

  public async getTrialSubscribersCount(trialDays: number): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT COUNT(*) as count
        FROM subscribers
        WHERE is_premium = 0
          AND datetime(created_at) >= datetime('now', '-' || ? || ' days')
      `);
      const row = stmt.get(trialDays) as { count: number };
      return row.count;
    } catch (error) {
      logger.error({ err: error }, "Error getting trial subscribers count");
      return 0;
    }
  }

  public async getFreeThrottledSubscribersCount(trialDays: number): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT COUNT(*) as count
        FROM subscribers
        WHERE is_premium = 0
          AND datetime(created_at) < datetime('now', '-' || ? || ' days')
      `);
      const row = stmt.get(trialDays) as { count: number };
      return row.count;
    } catch (error) {
      logger.error({ err: error }, "Error getting free throttled subscribers count");
      return 0;
    }
  }

  public async getAnomalousSubscribersCount(): Promise<number> {
    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT COUNT(*) as count
        FROM subscribers
        WHERE phone_number IS NULL OR phone_number = ''
          OR name IS NULL OR name = ''
      `);
      const row = stmt.get() as { count: number };
      return row.count;
    } catch (error) {
      logger.error({ err: error }, "Error getting anomalous subscribers count");
      return 0;
    }
  }
}