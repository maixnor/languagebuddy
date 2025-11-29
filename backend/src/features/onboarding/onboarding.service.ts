import Redis from 'ioredis';
import { logger } from '../../config';
import { OnboardingState } from './onboarding.types';

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
    const initialState: OnboardingState = {
      phone,
      gdprConsented: false,
      currentStep: 'gdpr_consent',
      tempData: {},
    };
    await this.redis.set(`onboarding:${phone}`, JSON.stringify(initialState), 'EX', 60 * 60 * 24); // 24 hours expiry
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

  async getOnboardingState(phone: string): Promise<OnboardingState | null> {
    const stateString = await this.redis.get(`onboarding:${phone}`);
    if (!stateString) {
      return null;
    }
    return JSON.parse(stateString) as OnboardingState;
  }

  async updateOnboardingState(phone: string, updates: Partial<OnboardingState>): Promise<void> {
    const currentState = await this.getOnboardingState(phone);
    if (!currentState) {
      logger.warn({ phone, updates }, "Attempted to update non-existent onboarding state");
      return;
    }

    const newState = {
      ...currentState,
      ...updates,
      tempData: {
        ...currentState.tempData,
        ...updates.tempData,
      },
    };

    await this.redis.set(`onboarding:${phone}`, JSON.stringify(newState), 'EX', 60 * 60 * 24);
    logger.info({ phone, updates }, "Updated onboarding state");
  }
}
