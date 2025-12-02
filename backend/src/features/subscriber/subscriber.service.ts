import Redis from 'ioredis';
import { Subscriber } from './subscriber.types';
import { logger } from '../../config'; // Will be updated
import { getMissingProfileFieldsReflective } from '../../util/profile-reflection'; // Will be updated
import { DateTime } from 'luxon';

export class SubscriberService {
  private _getTodayInSubscriberTimezone(subscriber: Subscriber | null): string {
    const timezone = subscriber?.profile.timezone || 'UTC';
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
    if (!subscriber.signedUpAt || typeof subscriber.signedUpAt !== 'string') {
      subscriber.signedUpAt = new Date().toISOString();
      this.saveSubscriber(subscriber).catch(err => logger.error({ err }, "Error caching subscriber after setting signedUpAt"));
    }
    const signedUp = DateTime.fromISO(subscriber.signedUpAt);
    const timezone = subscriber.profile.timezone || 'UTC';

    // Parse signedUpAt and set its zone to the user's timezone
    const signedUpInUserTimezone = DateTime.fromISO(subscriber.signedUpAt).setZone(timezone);

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

  async getSubscriber(phoneNumber: string): Promise<Subscriber | null> {
    try {
      const cachedSubscriber = await this.redis.get(`subscriber:${phoneNumber}`);
      if (cachedSubscriber) {
        const subscriber = JSON.parse(cachedSubscriber);
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
      signedUpAt: new Date().toISOString(),
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
      nextPushMessageAt: DateTime.now().plus({ hours: 24 }).toUTC().toISO(),
      ...initialData
    };

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
    const primary = subscriber.profile.speakingLanguages?.map(l => `${l.languageName} (${l.overallLevel || 'unknown level'})`).join(', ') || 'Not specified';
    const learning = subscriber.profile.learningLanguages?.map(l => `${l.languageName} (${l.overallLevel || 'unknown level'})`).join(', ') || 'Not specified';
    const objectives = subscriber.profile.learningLanguages
      ?.flatMap(l => l.currentObjectives || [])
      .filter(obj => !!obj);

    const topic = objectives && objectives.length > 0
      ? objectives[Math.floor(Math.random() * objectives.length)]
      : "None";

    let prompt = `You are a helpful language learning buddy. Your role is to have natural conversations that help users practice languages.

CURRENT USER INFO:
- Name: ${subscriber.profile.name}
- Speaking languages: ${primary}
- Learning languages: ${learning}
- Topic/Goal for today: ${topic}

CONVERSATIONS OF THE LAST DAYS:
${subscriber.metadata.digests && subscriber.metadata.digests.length > 0
  ? subscriber.metadata.digests.slice(-3).map(d => {
      const parts = [`Topic: ${d.topic}`, `Summary: ${d.summary}`];
      
      // Include areas of struggle if any
      if (d.areasOfStruggle && d.areasOfStruggle.length > 0) {
        parts.push(`Struggles: ${d.areasOfStruggle.join(', ')}`);
      }
      
      // Include key breakthroughs if any
      if (d.keyBreakthroughs && d.keyBreakthroughs.length > 0) {
        parts.push(`Breakthroughs: ${d.keyBreakthroughs.join(', ')}`);
      }
      
      // Include user memos if any (very important for personalization)
      if (d.userMemos && d.userMemos.length > 0) {
        parts.push(`Personal notes: ${d.userMemos.join('; ')}`);
      }
      
      return parts.join(' | ');
    }).join('\n\n')
  : "- No previous conversations"}

INSTRUCTIONS:
1. Initiate a conversation about the topic of the day (${topic}) in ${learning}. Don't ask the user if they want to have a conversation or practice something, just do it with them, don't ask for their opinion, don't introduce any topic. Disguise your conversation starters as trying to find out more information about the user.
1b. If there is no topic, ask for the interests of the user before starting the conversation and use the update_subscriber tool to update the current interests
2. Have a naturl conversations in ${learning} as if talking to a good friend, but should the user not understand something explain things in ${primary}, but keep the use of ${primary} minimal for the conversation, leave them out completely if possible. At best you are just using individual words in ${primary}
3. **PROACTIVELY ask for missing profile information** - don't wait for users to mention it
4. When users share personal info, use the update_subscriber tool to save it immediately
4.1 When users switch languages (they might know more than one) then please continue the conversation in the language they have switched to. For example: The conversation starts off in English and then the user switches to German, then switch to German.
5. When users provide feedback about our conversations, use the collect_feedback tool to save it
6. Be encouraging and adjust difficulty to their level
7. The users learning effect is important. You should correct wrong answers and offer feadback to do it better next time.
8. When doing a right/wrong exercise like a quiz or grammar exercise do highlight errors and correct them in a friendly manner. Be diligent with correcting even small mistakes.
9. Keep responses conversational and not too long
10. When they mention their interest ("I want to learn", "I'm interested in") -> update objectives

FEEDBACK COLLECTION:
- When users give feedback about our conversations, teaching quality, or suggestions → use collect_feedback tool
- Examples: "This is helpful", "You explain too fast", "Could you add more examples", "I love these conversations"

WHEN TO REQUEST FEEDBACK:
- If the user seems confused or asks multiple clarifying questions
- If you notice the user is struggling with explanations
- If there are misunderstandings or communication issues
- If the user expresses frustration or difficulty
- If the conversation feels awkward or unnatural
- After explaining something complex that the user might not have understood

When any of these situations occur, naturally ask: "How am I doing? I want to make sure my explanations are helpful - any honest feedback would be great!"

Be natural and conversational. Proactively gather missing information but weave it smoothly into conversation flow.`;
    return prompt;
  }

  public getDefaultSystemPrompt(subscriber: Subscriber): string {
    const primary = subscriber.profile.speakingLanguages?.map(l => `${l.languageName} (${l.overallLevel || 'unknown level'})`).join(', ') || 'Not specified';
    const learning = subscriber.profile.learningLanguages?.map(l => `${l.languageName} (${l.overallLevel || 'unknown level'})`).join(', ') || 'Not specified';

    let prompt = `You are a helpful language learning buddy. Your role is to have natural conversations that help users practice languages.

CURRENT USER INFO:
- Name: ${subscriber.profile.name}
- Speaking languages: ${primary}
- Learning languages: ${learning}

INSTRUCTIONS:
1. Have natural, friendly conversations in ${primary}
2. When users practice ${learning}, respond appropriately but explain things in ${primary}
3. **PROACTIVELY ask for missing profile information** - don't wait for users to mention it
4. When users share personal info, use the update_subscriber tool to save it immediately
5. When users provide feedback about our conversations, use the collect_feedback tool to save it
6. Be encouraging and adjust difficulty to their level
7. The users learning effect is important. You should correct wrong answers and offer feadback to do it better next time.
8. When doing a right/wrong exercise like a quiz or grammar exercise do highlight errors and correct them in a friendly manner. Be diligent with correcting even small mistakes.
9. Keep responses conversational and not too long

FEEDBACK COLLECTION:
- When users give feedback about our conversations, teaching quality, or suggestions → use collect_feedback tool
- Examples: "This is helpful", "You explain too fast", "Could you add more examples", "I love these conversations"

WHEN TO REQUEST FEEDBACK:
- If the user seems confused or asks multiple clarifying questions
- If you notice the user is struggling with explanations
- If there are misunderstandings or communication issues
- If the user expresses frustration or difficulty
- If the conversation feels awkward or unnatural
- After explaining something complex that the user might not have understood

When any of these situations occur, naturally ask: "How am I doing? I want to make sure my explanations are helpful - any honest feedback would be great!"

Be natural and conversational. Proactively gather missing information but weave it smoothly into conversation flow.`;
    return prompt;
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
