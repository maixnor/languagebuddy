import { DateTime } from 'luxon';
import Redis from 'ioredis';
import { SubscriberService } from './subscriber.service';
import { Subscriber } from './subscriber.types';
import { logger } from '../../core/config';

describe('SubscriberService - Throttling Logic (Integration)', () => {
  let redis: Redis;
  let subscriberService: SubscriberService;
  const testPhone = '+1234567890';

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
    
    // Reset singleton instance for fresh state
    (SubscriberService as any).instance = null;
    subscriberService = SubscriberService.getInstance(redis);

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
});