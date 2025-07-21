import Redis from 'ioredis';
import { Subscriber } from '../types';
import { logger } from '../config';
import { getMissingProfileFieldsReflective } from '../util/profile-reflection';

export class SubscriberService {
  private static instance: SubscriberService;
  private redis: Redis;

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
      metadata: {
        digests: [],
        personality: "A friendly language buddy talking about everything",
      },
      isPremium: false,
      lastActiveAt: new Date(),
      ...initialData
    };

    // Check if profile is missing required fields (reflection-based)
    const missingFields = getMissingProfileFieldsReflective(subscriber.profile);
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
    const primary = subscriber.profile.speakingLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';
    const learning = subscriber.profile.learningLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';
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
    const primary = subscriber.profile.speakingLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';
    const learning = subscriber.profile.learningLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';

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
      if (!lang.level) {
        missing.push(`${lang.languageName} level`);
      }
    });

    subscriber.profile.speakingLanguages?.forEach((lang, index) => {
      if (!lang.level) {
        missing.push(`${lang.languageName} level`);
      }
    });

    if (!subscriber.profile.timezone) {
      missing.push("timezone/location");
    }

    return missing;
  }
}