import { logger } from '../../core/config';
import { OnboardingState } from './onboarding.types';

/**
 * @deprecated Onboarding state is now managed implicitly via conversation checkpoints.
 * This class is kept for compatibility with ServiceContainer but should be removed.
 */
export class OnboardingService {
  private static instance: OnboardingService;

  private constructor() {}

  static getInstance(): OnboardingService {
    if (!OnboardingService.instance) {
      OnboardingService.instance = new OnboardingService();
    }
    return OnboardingService.instance;
  }

  // Deprecated methods
  async startOnboarding(phone: string): Promise<void> {
    logger.warn({ phone }, "Deprecated startOnboarding called");
  }

  async completeOnboarding(phone: string): Promise<void> {
    logger.warn({ phone }, "Deprecated completeOnboarding called");
  }

  async isInOnboarding(phone: string): Promise<boolean> {
    return false;
  }

  async getOnboardingState(phone: string): Promise<OnboardingState | null> {
    return null;
  }

  async updateOnboardingState(phone: string, updates: Partial<OnboardingState>): Promise<void> {
    logger.warn({ phone }, "Deprecated updateOnboardingState called");
  }
}