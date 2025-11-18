
import { DateTime } from 'luxon';
import Redis from 'ioredis';
import { SubscriberService } from '../../src/services/subscriber-service';
import { Subscriber } from '../../src/types';

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

    it('should NOT throttle user on day 7 (last day of trial)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
        isPremium: false,
      });

      // BUG?: Documentation says "after day 7" but is day 7 inclusive or exclusive?
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
    });

    it('should throttle user on day 8 (first day after trial)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 8 }).toISO(),
        isPremium: false,
      });

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

    it('should handle exactly 7.0 days (boundary condition)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 7, hours: 0, minutes: 0, seconds: 0 }).toISO(),
        isPremium: false,
      });

      // BUG POTENTIAL: Is this exactly 7 days or slightly more?
      const result = subscriberService.shouldThrottle(subscriber);
      expect(result).toBe(false);
    });

    it('should handle 7 days + 1 second (just over threshold)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 7, seconds: 1 }).toISO(),
        isPremium: false,
      });

      // BUG POTENTIAL: Should this trigger throttling?
      const result = subscriberService.shouldThrottle(subscriber);
      expect(result).toBe(true);
    });

    it('should handle invalid signedUpAt format gracefully', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: 'invalid-date-string' as any,
        isPremium: false,
      });

      // Should not throw, should handle gracefully
      expect(() => subscriberService.shouldThrottle(subscriber)).not.toThrow();
    });
  });

  describe('canStartConversationToday()', () => {
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
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      await redis.del(key);

      // Should allow conversation again
      canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
    });

    it('should handle timezone-based date boundaries correctly', async () => {
      // BUG POTENTIAL: DateTime.now().toISODate() uses local timezone
      // If user is in different timezone, this could cause issues
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      
      await subscriberService.incrementConversationCount(testPhone);
      
      // Verify the key was created with correct date
      const storedValue = await redis.get(key);
      expect(storedValue).toBe('1');
    });

    it('should use different keys for different dates', async () => {
      const today = DateTime.now().toISODate();
      const yesterday = DateTime.now().minus({ days: 1 }).toISODate();
      
      // Set yesterday's count manually
      const yesterdayKey = `conversation_count:${testPhone}:${yesterday}`;
      await redis.set(yesterdayKey, '1', 'EX', 86400);
      
      // Should still allow conversation today (different key)
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
    });

    it('should handle concurrent calls (race condition test)', async () => {
      // BUG POTENTIAL: Race condition when multiple requests check at same time
      const results = await Promise.all([
        subscriberService.canStartConversationToday(testPhone),
        subscriberService.canStartConversationToday(testPhone),
        subscriberService.canStartConversationToday(testPhone),
      ]);

      // All should return true since we haven't incremented yet
      expect(results).toEqual([true, true, true]);
    });
  });

  describe('incrementConversationCount()', () => {
    it('should set count to 1 on first increment', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      expect(count).toBe('1');
    });

    it('should increment existing count', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      expect(count).toBe('2');
    });

    it('should set TTL on first increment', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const ttl = await redis.ttl(key);
      
      // TTL should be set to 86400 seconds (24 hours)
      // Allow some wiggle room for test execution time
      expect(ttl).toBeGreaterThan(86000);
      expect(ttl).toBeLessThanOrEqual(86400);
    });

    it('should NOT reset TTL on subsequent increments', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const ttl = await redis.ttl(key);
      
      // BUG POTENTIAL: If INCR doesn't preserve TTL, key might become persistent
      // TTL should still be set and less than original 86400
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThan(86400);
    });

    it('should handle concurrent increments (race condition test)', async () => {
      // BUG POTENTIAL: Race condition when incrementing simultaneously
      await Promise.all([
        subscriberService.incrementConversationCount(testPhone),
        subscriberService.incrementConversationCount(testPhone),
        subscriberService.incrementConversationCount(testPhone),
      ]);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      // BUG POTENTIAL: Could be '1' if race condition exists in SET vs INCR logic
      expect(count).toBe('3');
    });

    it('should handle rapid increments without losing count', async () => {
      // Simulate rapid fire messages
      for (let i = 0; i < 10; i++) {
        await subscriberService.incrementConversationCount(testPhone);
      }
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      expect(count).toBe('10');
    });
  });

  describe('getDaysSinceSignup()', () => {
    it('should calculate days correctly for recent signup', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 3 }).toISO(),
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      expect(days).toBe(3);
    });

    it('should use floor for partial days', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 3, hours: 23 }).toISO(),
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      // Should floor to 3, not 4
      expect(days).toBe(3);
    });

    it('should handle signup time of day correctly', async () => {
      // Signed up at 11:59 PM yesterday
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 1 }).set({ hour: 23, minute: 59 }).toISO(),
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      // BUG POTENTIAL: Might be 0 or 1 depending on current time
      expect(days).toBeGreaterThanOrEqual(0);
    });

    it('should handle timezone differences (if any)', async () => {
      // User signed up in UTC, but we're in different timezone
      const utcSignup = DateTime.now().setZone('UTC').minus({ days: 7 }).toISO();
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: utcSignup,
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      // Should be approximately 7, regardless of local timezone
      expect(days).toBeGreaterThanOrEqual(6);
      expect(days).toBeLessThanOrEqual(7);
    });

    it('should set signedUpAt to now if missing', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone);
      delete (subscriber as any).signedUpAt;

      const days = subscriberService.getDaysSinceSignup(subscriber);
      
      expect(days).toBe(0);
      expect(subscriber.signedUpAt).toBeDefined();
    });

    it('should set signedUpAt to now if invalid type', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: 12345 as any, // Invalid: number instead of string
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      
      // Should handle gracefully and reset
      expect(typeof subscriber.signedUpAt).toBe('string');
    });
  });

  describe('shouldShowSubscriptionWarning()', () => {
    it('should NOT warn on days 0-2', async () => {
      for (let day = 0; day <= 2; day++) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      }
    });

    it('should warn on days 3-6', async () => {
      for (let day = 3; day <= 6; day++) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(true);
      }
    });

    it('should NOT warn on day 7 or later', async () => {
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
    it('should NOT prompt before day 8', async () => {
      for (let day = 0; day <= 7; day++) {
        const subscriber = await subscriberService.createSubscriber(`${testPhone}_${day}`, {
          signedUpAt: DateTime.now().minus({ days: day }).toISO(),
          isPremium: false,
        });

        expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);
      }
    });

    it('should prompt on day 8 and later', async () => {
      for (let day = 8; day <= 30; day += 5) {
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
    it('should handle user upgrading to premium during trial', async () => {
      // User on day 5 of trial
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
        isPremium: false,
      });

      // Should show warning
      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(true);
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);

      // User upgrades to premium
      await subscriberService.updateSubscriber(testPhone, { isPremium: true });
      const updatedSubscriber = await subscriberService.getSubscriber(testPhone);

      // Should no longer show warning or throttle
      expect(subscriberService.shouldShowSubscriptionWarning(updatedSubscriber!)).toBe(false);
      expect(subscriberService.shouldThrottle(updatedSubscriber!)).toBe(false);
    });

    it('should handle user at exactly day 7 boundary', async () => {
      // User signed up exactly 7 days ago, down to the second
      const exactlySevenDays = DateTime.now().minus({ days: 7 });
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: exactlySevenDays.toISO(),
        isPremium: false,
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      
      // BUG POTENTIAL: Floating point precision or floor logic
      expect(days).toBe(7);
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
    });

    it('should handle transition from day 7 to day 8', async () => {
      // User on last hour of day 7
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 7, hours: 23, minutes: 59 }).toISO(),
        isPremium: false,
      });

      // Should still be in trial
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      
      // Simulate time passing to day 8
      subscriber.signedUpAt = DateTime.now().minus({ days: 8, minutes: 1 }).toISO();
      
      // Now should throttle
      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);
    });
  });

  describe('Timezone and date boundary issues', () => {
    it('should handle date rollover at midnight', async () => {
      // Increment count just before midnight
      await subscriberService.incrementConversationCount(testPhone);
      
      const beforeMidnight = DateTime.now().toISODate();
      const keyBefore = `conversation_count:${testPhone}:${beforeMidnight}`;
      
      // Verify count exists
      const countBefore = await redis.get(keyBefore);
      expect(countBefore).toBe('1');
      
      // After midnight (simulated with different date), should be new key
      const afterMidnight = DateTime.now().plus({ days: 1 }).toISODate();
      const keyAfter = `conversation_count:${testPhone}:${afterMidnight}`;
      
      const countAfter = await redis.get(keyAfter);
      expect(countAfter).toBeNull();
    });

    it('should handle user in different timezone than server', async () => {
      // BUG POTENTIAL: Server uses DateTime.now() which is server's local time
      // User in Tokyo timezone
      const tokyoNow = DateTime.now().setZone('Asia/Tokyo');
      const serverNow = DateTime.now();
      
      // Dates might be different if it's near midnight
      const tokyoDate = tokyoNow.toISODate();
      const serverDate = serverNow.toISODate();
      
      // If dates differ, conversation count logic might be off by a day
      if (tokyoDate !== serverDate) {
        console.warn('BUG: Server and user timezone dates differ!', {
          tokyoDate,
          serverDate,
        });
      }
    });
  });
});
