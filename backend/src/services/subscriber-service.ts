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
      const subscriber = await this.getSubscriber(phoneNumber);
      if (!subscriber) {
        throw new Error(`Subscriber not found: ${phoneNumber}`);
      }

      logger.info(updates, `update user ${phoneNumber} with this info:`)
      // CURSOR currently dealing with the fact that the LLM cannot correclty use the updateSubscriberTool
      // strategy: reduce the complexity of the task to be just the learning language and the name. Then use a general approach and start adding more variables with greater detail to it
      Object.assign(subscriber, updates);
      subscriber.lastActiveAt = new Date();
      await this.cacheSubscriber(subscriber);

      logger.info({ phoneNumber, updates }, "Subscriber updated");
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
}