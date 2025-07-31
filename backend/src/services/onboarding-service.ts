import Redis from 'ioredis';
import { logger } from '../config';

export class OnboardingService {
  private static instance: OnboardingService;
  private redis: Redis;

  private constructor(redis: Redis) {
    this.redis = redis;
  }

  static getInstance(redis?: Redis): OnboardingService {
    if (!OnboardingService.instance) {
      if (!redis) {
        throw new Error("Redis instance required for first initialization");
      }
      OnboardingService.instance = new OnboardingService(redis);
    }
    return OnboardingService.instance;
  }

  async startOnboarding(phone: string): Promise<void> {
    await this.redis.set(`onboarding:${phone}`, null, 'EX', 60 * 60 * 24); // 24 hours expiry
    logger.info({ phone }, "Started onboarding process");
  }

  async completeOnboarding(phone: string): Promise<void> {
    try {
      await this.redis.del(`onboarding:${phone}`);
      logger.info({ phone }, "Completed onboarding process");
    } catch (error) {
      logger.error({ err: error, phone }, "Error completing onboarding");
      throw error;
    }
  }

  async isInOnboarding(phone: string): Promise<boolean> {
    return await this.redis.exists(`onboarding:${phone}`) === 1;
  }
}
