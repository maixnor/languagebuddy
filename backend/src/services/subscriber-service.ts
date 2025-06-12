import Redis from 'ioredis';
import { Subscriber } from '../types';
import { logger } from '../config';

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
      phone: phoneNumber,
      name: "New User",
      speakingLanguages: [],
      learningLanguages: [],
      isPremium: false,
      lastActiveAt: new Date(),
      ...initialData
    };

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

      logger.info({ count: subscribers.length }, "Retrieved all subscribers");
      return subscribers;
    } catch (error) {
      logger.error({ err: error }, "Error getting all subscribers");
      return [];
    }
  }

  private async cacheSubscriber(subscriber: Subscriber): Promise<void> {
    try {
      // Cache for 7 days
      const expireTime = 7 * 24 * 60 * 60;
      await this.redis.setex(
        `subscriber:${subscriber.phone}`, 
        expireTime, 
        JSON.stringify(subscriber)
      );
    } catch (error) {
      logger.error({ err: error, phone: subscriber.phone }, "Error caching subscriber");
    }
  }

  public getSystemPrompt(subscriber: Subscriber): string {
    const missingInfo = this.identifyMissingInfo(subscriber);
    const primary = subscriber.speakingLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';
    const learning = subscriber.learningLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';

    let prompt = `You are a helpful language learning buddy. Your role is to have natural conversations that help users practice languages.

CURRENT USER INFO:
- Name: ${subscriber.name}
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
7. Keep responses conversational and not too long
`;

    if (missingInfo && missingInfo.length > 0) {
      prompt += `
  PROACTIVE INFORMATION GATHERING:
  ${this.generateInfoGatheringInstructions(missingInfo)}
  `
    }
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

    if (!subscriber.name || subscriber.name === "New User") {
      missing.push("name");
    }

    if (!subscriber.speakingLanguages || subscriber.speakingLanguages.length === 0) {
      missing.push("native/speaking languages");
    }

    if (!subscriber.learningLanguages || subscriber.learningLanguages.length === 0) {
      missing.push("learning languages");
    }

    subscriber.learningLanguages?.forEach((lang, index) => {
      if (!lang.level) {
        missing.push(`${lang.languageName} level`);
      }
    });

    subscriber.speakingLanguages?.forEach((lang, index) => {
      if (!lang.level) {
        missing.push(`${lang.languageName} level`);
      }
    });

    if (!subscriber.timezone) {
      missing.push("timezone/location");
    }

    return missing;
  }

  private generateInfoGatheringInstructions(missingInfo: string[]): string {
    if (missingInfo.length === 0) {
      return "✅ Profile complete! Focus on natural conversation.";
    }

    const instructions: string[] = [];

    if (missingInfo.includes("name")) {
      instructions.push("- Ask for their name early in conversation: 'What should I call you?'");
    }

    if (missingInfo.includes("native/speaking languages")) {
      instructions.push("- Ask about their native or proficient language(s).");
    }

    if (missingInfo.includes("learning languages")) {
      instructions.push("- Ask what language(s) they want to learn.");
    }

    if (missingInfo.some(info => info.includes("level"))) {
      instructions.push("- Ask about their language level in the learning language.");
    }

    if (missingInfo.includes("timezone/location")) {
      instructions.push("- Ask about approximate location for the time zone");
    }

    instructions.push(`
⚠️ PRIORITY: Ask for the most important missing info (${missingInfo.join(', ')}) in the first few messages.
📋 ASK ONE QUESTION AT A TIME - don't overwhelm the user with multiple questions at once.`);

    return instructions.join('\n');
  }
}