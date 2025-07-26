import Redis from 'ioredis';
import { logger } from '../config';
import { OnboardingState } from '../types';

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
    const onboardingState: OnboardingState = {
      phone,
      currentStep: 'gdpr_consent',
      gdprConsented: false
    };
    
    await this.redis.set(`onboarding:${phone}`, JSON.stringify(onboardingState), 'EX', 60 * 60 * 24); // 24 hours expiry
    logger.info({ phone }, "Started onboarding process");
  }

  async getOnboardingState(phone: string): Promise<OnboardingState | null> {
    try {
      const state = await this.redis.get(`onboarding:${phone}`);
      return state ? JSON.parse(state) : null;
    } catch (error) {
      logger.error({ err: error, phone }, "Error getting onboarding state");
      return null;
    }
  }

  async updateOnboardingState(phone: string, updates: Partial<OnboardingState>): Promise<void> {
    try {
      const currentState = await this.getOnboardingState(phone);
      if (!currentState) {
        throw new Error(`No onboarding state found for phone ${phone}`);
      }

      const updatedState = { ...currentState, ...updates };
      await this.redis.set(`onboarding:${phone}`, JSON.stringify(updatedState), 'EX', 60 * 60 * 24);
      logger.info({ phone, updates }, "Updated onboarding state");
    } catch (error) {
      logger.error({ err: error, phone, updates }, "Error updating onboarding state");
      throw error;
    }
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
    const state = await this.getOnboardingState(phone);
    return state !== null;
  }
}
