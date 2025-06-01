import Redis from 'ioredis';
import { Subscriber, ConversationDigest } from '../types';
import { logger, config } from '../config';
import { StripeService } from './stripe-service';
import { RedisCheckpointSaver } from '../persistence/redis-checkpointer';

export class SubscriberService {
  private static instance: SubscriberService;
  private redis: Redis;
  private checkpointSaver: RedisCheckpointSaver;
  private stripeService: StripeService;

  private constructor(redis: Redis) {
    this.redis = redis;
    this.checkpointSaver = new RedisCheckpointSaver(redis);
    this.stripeService = StripeService.getInstance();
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
      // Try to get from Redis cache first
      const cachedSubscriber = await this.redis.get(`subscriber:${phoneNumber}`);
      if (cachedSubscriber) {
        const subscriber = JSON.parse(cachedSubscriber);
        // Update premium status and last active time
        subscriber.isPremium = await this.stripeService.checkSubscription(phoneNumber);
        subscriber.lastActiveAt = new Date();
        return subscriber;
      }

      // If not in cache, try to get from Stripe metadata
      const stripeData = await this.stripeService.getCustomerMetadata(phoneNumber);
      if (stripeData) {
        const subscriber: Subscriber = {
          phone: phoneNumber,
          name: stripeData.name || "New User",
          speakingLanguages: stripeData.speakingLanguages || [],
          learningLanguages: stripeData.learningLanguages || [],
          messageHistory: [],
          isPremium: await this.stripeService.checkSubscription(phoneNumber),
          lastActiveAt: new Date(),
          conversationDigests: []
        };

        // Cache the subscriber
        await this.cacheSubscriber(subscriber);
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
      name: initialData?.name || "New User",
      speakingLanguages: initialData?.speakingLanguages || [],
      learningLanguages: initialData?.learningLanguages || [],
      messageHistory: [],
      isPremium: await this.stripeService.checkSubscription(phoneNumber),
      lastActiveAt: new Date(),
      conversationDigests: [],
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

      // Update the subscriber object
      Object.assign(subscriber, updates);
      subscriber.lastActiveAt = new Date();

      // Cache the updated subscriber
      await this.cacheSubscriber(subscriber);

      // Update Stripe metadata if relevant fields changed
      const stripeRelevantFields = ['name', 'speakingLanguages', 'learningLanguages', 'timezone'];
      const hasStripeRelevantUpdates = Object.keys(updates).some(key => 
        stripeRelevantFields.includes(key)
      );

      if (hasStripeRelevantUpdates) {
        // Convert complex types to strings for Stripe metadata
        const stripeUpdates: Record<string, string | number | null> = {};
        Object.entries(updates).forEach(([key, value]) => {
          if (stripeRelevantFields.includes(key)) {
            if (key === 'speakingLanguages' || key === 'learningLanguages') {
              stripeUpdates[key] = JSON.stringify(value);
            } else {
              stripeUpdates[key] = value as string | number | null;
            }
          }
        });
        await this.stripeService.updateCustomerMetadata(phoneNumber, stripeUpdates);
      }

      logger.info({ phoneNumber, updates }, "Subscriber updated");
    } catch (error) {
      logger.error({ err: error, phoneNumber, updates }, "Error updating subscriber");
      throw error;
    }
  }

  async checkFeatureAccess(phoneNumber: string, feature: string): Promise<boolean> {
    const subscriber = await this.getSubscriber(phoneNumber);
    if (!subscriber) return false;

    const isPremium = subscriber.isPremium;
    const freeFeatures = config.features.freeUser.allowedFeatures;
    const restrictedFeatures = config.features.freeUser.restrictedFeatures;

    if (isPremium) {
      return true; // Premium users have access to all features
    }

    // Check if feature is restricted for free users
    if (restrictedFeatures.includes(feature)) {
      return false;
    }

    // Check if feature is explicitly allowed for free users
    return freeFeatures.includes(feature) || freeFeatures.includes('all');
  }

  async saveConversationDigest(phoneNumber: string, digest: ConversationDigest): Promise<void> {
    try {
      await this.checkpointSaver.saveConversationDigest(phoneNumber, digest);
      
      // Also update the subscriber's digest array if they're premium
      const subscriber = await this.getSubscriber(phoneNumber);
      if (subscriber?.isPremium) {
        if (!subscriber.conversationDigests) {
          subscriber.conversationDigests = [];
        }
        subscriber.conversationDigests.push(digest);
        
        // Keep only last 30 digests to avoid memory issues
        if (subscriber.conversationDigests.length > 30) {
          subscriber.conversationDigests = subscriber.conversationDigests.slice(-30);
        }
        
        await this.cacheSubscriber(subscriber);
      }
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error saving conversation digest");
      throw error;
    }
  }

  async getStoredLearningData(phoneNumber: string): Promise<any> {
    return await this.checkpointSaver.getStoredLearningData(phoneNumber);
  }

  async clearUserHistoryForFreeUser(phoneNumber: string): Promise<void> {
    const subscriber = await this.getSubscriber(phoneNumber);
    if (!subscriber || subscriber.isPremium) {
      return; // Don't clear history for premium users
    }

    try {
      await this.checkpointSaver.clearUserHistory(phoneNumber);
      logger.info({ phoneNumber }, "Cleared conversation history for free user");
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error clearing user history");
    }
  }

  private async cacheSubscriber(subscriber: Subscriber): Promise<void> {
    try {
      const expireTime = subscriber.isPremium ? 7 * 24 * 60 * 60 : 24 * 60 * 60; // 7 days vs 1 day
      await this.redis.setex(
        `subscriber:${subscriber.phone}`, 
        expireTime, 
        JSON.stringify(subscriber)
      );
    } catch (error) {
      logger.error({ err: error, phone: subscriber.phone }, "Error caching subscriber");
    }
  }

  async getAllSubscribers(): Promise<Subscriber[]> {
    try {
      const keys = await this.redis.keys('subscriber:*');
      const subscribers: Subscriber[] = [];

      for (const key of keys) {
        const subscriberData = await this.redis.get(key);
        if (subscriberData) {
          subscribers.push(JSON.parse(subscriberData));
        }
      }

      return subscribers;
    } catch (error) {
      logger.error({ err: error }, "Error getting all subscribers");
      return [];
    }
  }
}