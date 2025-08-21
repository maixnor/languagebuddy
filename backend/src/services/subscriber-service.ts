import Redis from 'ioredis';
import { Subscriber } from '../types';
import { logger } from '../config';
import { getMissingProfileFieldsReflective } from '../util/profile-reflection';
import { DateTime } from 'luxon';

export class SubscriberService {
  /**
   * Returns true if the user can start a conversation today (throttle logic).
   * Only allows one conversation per day for non-premium users after trial.
   */
  public async canStartConversationToday(phoneNumber: string): Promise<boolean> {
    const today = DateTime.now().toISODate();
    const key = `conversation_count:${phoneNumber}:${today}`;
    const count = await this.redis.get(key);
    return !count || parseInt(count) < 1;
  }

  /**
   * Increments the daily conversation count for the user.
   */
  public async incrementConversationCount(phoneNumber: string): Promise<void> {
    const today = DateTime.now().toISODate();
    const key = `conversation_count:${phoneNumber}:${today}`;
    const count = await this.redis.get(key);
    if (!count) {
      await this.redis.set(key, "1", "EX", 86400); // expire after 1 day
    } else {
      await this.redis.incr(key);
    }
  }
  private static instance: SubscriberService;
  private redis: Redis;

  /**
   * Returns the number of days since the user signed up.
   */
  public getDaysSinceSignup(subscriber: Subscriber): number {
    if (!subscriber.signedUpAt || typeof subscriber.signedUpAt !== 'string') {
      subscriber.signedUpAt = new Date().toISOString();
      this.cacheSubscriber(subscriber).catch(err => logger.error({ err }, "Error caching subscriber after setting signedUpAt"));
    }
    const signedUp = DateTime.fromISO(subscriber.signedUpAt);
    return Math.floor(DateTime.now().diff(signedUp, 'days').days);
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
          lastActiveDate: new Date(),
        },
        predictedChurnRisk: 0,
        engagementScore: 0,
        difficultyPreference: "moderate"
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

    await this.cacheSubscriber(subscriber);
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
      await this.cacheSubscriber(subscriber);

      // Re-check missing fields after update (reflection-based)
      const missingFields = getMissingProfileFieldsReflective(subscriber.profile);
      if (missingFields.length > 0) {
        logger.trace({ missingFields, phoneNumber }, "Subscriber updated with missing profile fields");
      }

      logger.info({updates: updates}, `Updated user ${phoneNumber} with this info:`)
    } catch (error) {
      logger.error({ err: error, phoneNumber, updates }, "Error updating subscriber");
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

  private async cacheSubscriber(subscriber: Subscriber): Promise<void> {
    try {
      // Cache for 7 days
      await this.redis.set(
        `subscriber:${subscriber.connections.phone}`, 
        JSON.stringify(subscriber)
      );
    } catch (error) {
      logger.error({ err: error, phone: subscriber.connections.phone }, "Error caching subscriber");
    }
  }

  public async createDigest(subscriber: Subscriber): Promise<void> {
    // fetch conversation from redis
    // convert conversation into a machine-readable format
    // send one-shot conversation to GPT to extract necessary info and pack into a Digest object
    // append digest to subscriber
    // save subscriber
    // delete conversation in redis
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
- Topic for today: ${topic}

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
`;

    prompt +=
        `
PROFILE UPDATES:
- When users mention their name ("I'm John", "Call me Maria") → update name
- When they mention languages ("I speak French", "I'm learning Spanish") → update languages  
- When they mention their level ("I'm a beginner", "I'm intermediate") → update level
- When they mention their interest ("I want to learn", "I'm interested in") -> update objectives
- When they mention location/timezone → update timezone

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
    const missingInfo = this.identifyMissingInfo(subscriber);
    const primary = subscriber.profile.speakingLanguages?.map(l => `${l.languageName} (${l.overallLevel || 'unknown level'})`).join(', ') || 'Not specified';
    const learning = subscriber.profile.learningLanguages?.map(l => `${l.languageName} (${l.overallLevel || 'unknown level'})`).join(', ') || 'Not specified';

    let prompt = `You are a helpful language learning buddy. Your role is to have natural conversations that help users practice languages.

CURRENT USER INFO:
- Name: ${subscriber.profile.name}
- Speaking languages: ${primary}
- Learning languages: ${learning}

MISSING PROFILE INFO: ${missingInfo.length > 0 ? missingInfo.join(', ') : 'None'}

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
`;

    prompt +=
        `
PROFILE UPDATES:
- When users mention their name ("I'm John", "Call me Maria") → update name
- When they mention languages ("I speak French", "I'm learning Spanish") → update languages  
- When they mention their level ("I'm a beginner", "I'm intermediate") → update level
- When they mention location/timezone → update timezone

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

  private identifyMissingInfo(subscriber: Subscriber): string[] {
    const missing: string[] = [];

    if (!subscriber.profile.name || subscriber.profile.name === "New User") {
      missing.push("name");
    }

    if (!subscriber.profile.speakingLanguages || subscriber.profile.speakingLanguages.length === 0) {
      missing.push("native/speaking languages");
    }

    if (!subscriber.profile.learningLanguages || subscriber.profile.learningLanguages.length === 0) {
      missing.push("learning languages");
    }

    subscriber.profile.learningLanguages?.forEach((lang, index) => {
      if (!lang.overallLevel) {
        missing.push(`${lang.languageName} level`);
      }
    });

    subscriber.profile.speakingLanguages?.forEach((lang, index) => {
      if (!lang.overallLevel) {
        missing.push(`${lang.languageName} level`);
      }
    });

    if (!subscriber.profile.timezone) {
      missing.push("timezone/location");
    }

    return missing;
  }

  async addLanguageDeficiencyToSubscriber(
    phoneNumber: string, 
    languageName: string, 
    deficiency: Omit<import('../types').LanguageDeficiency, 'firstDetected' | 'lastOccurrence'>
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
      await this.cacheSubscriber(subscriber);
      logger.info({ phoneNumber, languageName, deficiency: completeDeficiency }, "Added language deficiency to subscriber");
    } catch (error) {
      logger.error({ err: error, phoneNumber, languageName, deficiency }, "Error adding language deficiency");
      throw error;
    }
  }
}