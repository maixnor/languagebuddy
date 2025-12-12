import { DateTime } from 'luxon';
import Redis from 'ioredis';
import { SubscriberService } from './subscriber.service';
import { Subscriber } from './subscriber.types';
import * as configModule from '../../core/config'; // Import as module to mock
import * as subscriberUtils from './subscriber.utils'; // Import as module to mock


// Mock the config module
jest.mock('../../core/config', () => ({
  ...jest.requireActual('../../core/config'), // Keep original logger, etc.
  config: {
    ...jest.requireActual('../../core/config').config, // Use actual config for other properties
    test: {
      phoneNumbers: [],
      skipStripeCheck: false,
    },
  },
  logger: jest.requireActual('../../core/config').logger, // Ensure logger is not mocked
}));

// Mock isTestPhoneNumber
jest.mock('./subscriber.utils', () => ({
  ...jest.requireActual('./subscriber.utils'),
  isTestPhoneNumber: jest.fn(),
}));

const mockedConfig = configModule.config as jest.Mocked<typeof configModule.config>;
const mockedIsTestPhoneNumber = subscriberUtils.isTestPhoneNumber as jest.Mock;

describe('SubscriberService - Throttling Logic (Integration)', () => {
  let redis: Redis;
  let subscriberService: SubscriberService;
  const testPhone = '+1234567890';
  const testPhone69 = '+69123456789';
  const whitelistedPhone = '+19998887777';

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear test data before each test
    const keys = await redis.keys(`*${testPhone}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    const keys69 = await redis.keys(`*${testPhone69}*`);
    if (keys69.length > 0) {
      await redis.del(...keys69);
    }
    const keysWhitelisted = await redis.keys(`*${whitelistedPhone}*`);
    if (keysWhitelisted.length > 0) {
      await redis.del(...keysWhitelisted);
    }
    
    // Reset singleton instance for fresh state
    (SubscriberService as any).instance = null;
    subscriberService = SubscriberService.getInstance(redis);

    // Reset mocks
    mockedConfig.test.skipStripeCheck = false;
    mockedConfig.test.phoneNumbers = [];
    mockedIsTestPhoneNumber.mockClear();
    mockedIsTestPhoneNumber.mockImplementation((phoneNumber: string) => phoneNumber.startsWith('+69') || phoneNumber.startsWith('69'));

    // Ensure test subscriber has a default timezone for consistent key generation
    await subscriberService.createSubscriber(testPhone, {
      profile: {
        timezone: 'UTC'
      }
    });
  });

  afterEach(async () => {
    // Clean up test data after each test
    const keys = await redis.keys(`*${testPhone}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    const keys69 = await redis.keys(`*${testPhone69}*`);
    if (keys69.length > 0) {
      await redis.del(...keys69);
    }
    const keysWhitelisted = await redis.keys(`*${whitelistedPhone}*`);
    if (keysWhitelisted.length > 0) {
      await redis.del(...keysWhitelisted);
    }
  });

  describe('shouldThrottle()', () => {
    it('should NOT throttle user on day 0 (signup day)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
    });

    it('should NOT throttle user on day 6 (last day of trial)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 6 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
    });

    it('should throttle user on day 7 (first day after trial)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
        isPremium: false,
      });

      // Requirement: "After that 7 days there NEEDS to be a stripe customer"
      // Days 0-6 are the 7 days. Day 7 is after.
      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);
    });

    it('should NOT throttle premium user even after day 7', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 30 }).toISO(),
        isPremium: true,
      });

      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
    });

    it('should handle missing signedUpAt by setting it to now (edge case)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        isPremium: false,
      });
      
      // Manually remove signedUpAt to test the edge case
      delete (subscriber as any).signedUpAt;
      
      // First call should set signedUpAt
      const result = subscriberService.shouldThrottle(subscriber);
      
      // Should not throttle a brand new user
      expect(result).toBe(false);
      expect(subscriber.signedUpAt).toBeDefined();
    });
  });

  describe('canStartConversationToday()', () => {
    // These tests remain valid as canStartConversationToday tracks daily usage for free users (if not fully throttled)
    // or premium users (if we track usage).
    // Note: If shouldThrottle returns true, this method might not be called in the new flow,
    // but the logic inside it remains valid for its purpose.

    it('should allow first conversation of the day', async () => {
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
    });

    it('should NOT allow second conversation of the day', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(false);
    });

    it('should reset conversation count after Redis key expires (24h)', async () => {
      // Increment count
      await subscriberService.incrementConversationCount(testPhone);
      
      // Verify blocked
      let canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(false);

      // Manually expire the key (simulate 24h passing)
      const subscriber = await subscriberService.getSubscriber(testPhone);
      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
      const key = `conversation_count:${testPhone}:${today}`;
      await redis.del(key);

      // Should allow conversation again
      canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
    });
  });

  describe('shouldShowSubscriptionWarning()', () => {
    it('should NOT warn on days 0-4 (First 5 days)', async () => {
      for (let day = 0; day <= 4; day++) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      }
    });

    it('should warn on days 5-6 (Days 6 & 7)', async () => {
      for (let day = 5; day <= 6; day++) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(true);
      }
    });

    it('should NOT warn on day 7 or later (Throttled instead)', async () => {
      for (let day = 7; day <= 10; day++) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      }
    });

    it('should NOT warn if premium user', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
        isPremium: true,
      });

      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
    });
  });

  describe('shouldPromptForSubscription()', () => {
    it('should NOT prompt before day 7', async () => {
      for (let day = 0; day <= 6; day++) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);
      }
    });

    it('should prompt on day 7 and later', async () => {
      for (let day = 7; day <= 15; day += 5) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(true);
      }
    });

    it('should NOT prompt if premium user', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 30 }).toISO(),
        isPremium: true,
      });

      expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);
    });
  });

  describe('Trial period edge cases', () => {
    it('should handle user upgrading to premium during warning period', async () => {
      // User on day 5 (warning period)
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(true);
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);

      // User upgrades to premium
      await subscriberService.updateSubscriber(testPhone, { isPremium: true });
      const updatedSubscriber = await subscriberService.getSubscriber(testPhone);

      // Should no longer show warning or throttle
      expect(subscriberService.shouldShowSubscriptionWarning(updatedSubscriber!)).toBe(false);
      expect(subscriberService.shouldThrottle(updatedSubscriber!)).toBe(false);
    });
  });
  describe('Stripe Bypass Logic', () => {
    // These tests verify the `SKIP_STRIPE_CHECK`, `isTestPhoneNumber`, and `TEST_PHONE_NUMBERS` logic

    describe('createSubscriber and isPremium', () => {
      it('should set subscriber as premium if SKIP_STRIPE_CHECK is true', async () => {
        mockedConfig.test.skipStripeCheck = true;
        const subscriber = await subscriberService.createSubscriber(testPhone);
        expect(subscriber.isPremium).toBe(true);
      });

      it('should set subscriber as premium if phone number starts with +69', async () => {
        mockedConfig.test.skipStripeCheck = false; // Ensure global bypass is off
        const subscriber = await subscriberService.createSubscriber(testPhone69);
        expect(subscriber.isPremium).toBe(true);
      });

      it('should set subscriber as premium if phone number is in TEST_PHONE_NUMBERS list', async () => {
        mockedConfig.test.skipStripeCheck = false; // Ensure global bypass is off
        mockedConfig.test.phoneNumbers = [whitelistedPhone];
        const subscriber = await subscriberService.createSubscriber(whitelistedPhone);
        expect(subscriber.isPremium).toBe(true);
      });

      it('should not set subscriber as premium if none of the bypass conditions are met', async () => {
        mockedConfig.test.skipStripeCheck = false;
        mockedConfig.test.phoneNumbers = [];
        const subscriber = await subscriberService.createSubscriber(testPhone);
        expect(subscriber.isPremium).toBe(false);
      });
    });

    describe('shouldThrottle() with bypass conditions', () => {
      it('should NOT throttle if SKIP_STRIPE_CHECK is true', async () => {
        mockedConfig.test.skipStripeCheck = true;
        const subscriber = await subscriberService.createSubscriber(testPhone, {
          signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      });

      it('should NOT throttle if phone number starts with +69', async () => {
        mockedConfig.test.skipStripeCheck = false;
        const subscriber = await subscriberService.createSubscriber(testPhone69, {
          signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      });

      it('should NOT throttle if phone number is in TEST_PHONE_NUMBERS list', async () => {
        mockedConfig.test.skipStripeCheck = false;
        mockedConfig.test.phoneNumbers = [whitelistedPhone];
        const subscriber = await subscriberService.createSubscriber(whitelistedPhone, {
          signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      });

      it('should NOT throttle if phone number starts with "69" (without +)', async () => {
        mockedConfig.test.skipStripeCheck = false;
        const phoneWithoutPlus = '69123132'; // The reported problematic number
        const subscriber = await subscriberService.createSubscriber(phoneWithoutPlus, {
          signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldThrottle(subscriber)).toBe(false); // This is expected to fail initially
      });
    });

    describe('shouldShowSubscriptionWarning() with bypass conditions', () => {
      it('should NOT show warning if SKIP_STRIPE_CHECK is true', async () => {
        mockedConfig.test.skipStripeCheck = true;
        const subscriber = await subscriberService.createSubscriber(testPhone, {
          signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      });

      it('should NOT show warning if phone number starts with +69', async () => {
        mockedConfig.test.skipStripeCheck = false;
        const subscriber = await subscriberService.createSubscriber(testPhone69, {
          signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      });

      it('should NOT show warning if phone number is in TEST_PHONE_NUMBERS list', async () => {
        mockedConfig.test.skipStripeCheck = false;
        mockedConfig.test.phoneNumbers = [whitelistedPhone];
        const subscriber = await subscriberService.createSubscriber(whitelistedPhone, {
          signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      });
    });

    describe('shouldPromptForSubscription() with bypass conditions', () => {
      it('should NOT prompt if SKIP_STRIPE_CHECK is true', async () => {
        mockedConfig.test.skipStripeCheck = true;
        const subscriber = await subscriberService.createSubscriber(testPhone, {
          signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);
      });

      it('should NOT prompt if phone number starts with +69', async () => {
        mockedConfig.test.skipStripeCheck = false;
        const subscriber = await subscriberService.createSubscriber(testPhone69, {
          signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);
      });

      it('should NOT prompt if phone number is in TEST_PHONE_NUMBERS list', async () => {
        mockedConfig.test.skipStripeCheck = false;
        mockedConfig.test.phoneNumbers = [whitelistedPhone];
        const subscriber = await subscriberService.createSubscriber(whitelistedPhone, {
          signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
          isPremium: false,
        });
        expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);
      });
    });

    describe('canStartConversationToday() with bypass conditions', () => {
      it('should allow conversation if SKIP_STRIPE_CHECK is true, even if throttled', async () => {
        mockedConfig.test.skipStripeCheck = true;
        await subscriberService.incrementConversationCount(testPhone); // Simulate being throttled
        const canStart = await subscriberService.canStartConversationToday(testPhone);
        expect(canStart).toBe(true);
      });

      it('should allow conversation if phone number starts with +69, even if throttled', async () => {
        mockedConfig.test.skipStripeCheck = false;
        await subscriberService.incrementConversationCount(testPhone69); // Simulate being throttled
        const canStart = await subscriberService.canStartConversationToday(testPhone69);
        expect(canStart).toBe(true);
      });

      it('should allow conversation if phone number is in TEST_PHONE_NUMBERS list, even if throttled', async () => {
        mockedConfig.test.skipStripeCheck = false;
        mockedConfig.test.phoneNumbers = [whitelistedPhone];
        await subscriberService.incrementConversationCount(whitelistedPhone); // Simulate being throttled
        const canStart = await subscriberService.canStartConversationToday(whitelistedPhone);
        expect(canStart).toBe(true);
      });
    });

    describe('attemptToStartConversation() with bypass conditions', () => {
      it('should allow conversation and NOT increment count if SKIP_STRIPE_CHECK is true', async () => {
        mockedConfig.test.skipStripeCheck = true;
        await subscriberService.incrementConversationCount(testPhone); // Simulate being throttled
        const canStart = await subscriberService.attemptToStartConversation(testPhone);
        expect(canStart).toBe(true);
        
        const subscriber = await subscriberService.getSubscriber(testPhone);
        const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
        const key = `conversation_count:${testPhone}:${today}`;
        const count = await redis.get(key);
        expect(parseInt(count!)).toBe(1); // Should not have incremented beyond initial increment
      });

      it('should allow conversation and increment count if phone number starts with +69', async () => {
        mockedConfig.test.skipStripeCheck = false;
        const canStart = await subscriberService.attemptToStartConversation(testPhone69);
        expect(canStart).toBe(true);

        const subscriber = await subscriberService.getSubscriber(testPhone69);
        const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
        const key = `conversation_count:${testPhone69}:${today}`;
        const count = await redis.get(key);
        expect(parseInt(count!)).toBe(1);
      });

      it('should allow conversation and increment count if phone number is in TEST_PHONE_NUMBERS list', async () => {
        mockedConfig.test.skipStripeCheck = false;
        mockedConfig.test.phoneNumbers = [whitelistedPhone];
        const canStart = await subscriberService.attemptToStartConversation(whitelistedPhone);
        expect(canStart).toBe(true);

        const subscriber = await subscriberService.getSubscriber(whitelistedPhone);
        const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
        const key = `conversation_count:${whitelistedPhone}:${today}`;
        const count = await redis.get(key);
        expect(parseInt(count!)).toBe(1);
      });
    });
  });
});