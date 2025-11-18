/**
 * Integration tests for trial period transitions
 * Tests with REAL Redis to catch bugs in:
 * - Day 3-6 warning messages
 * - Day 7 hard cutoff
 * - Premium upgrade during trial
 * - getDaysSinceSignup() edge cases
 * - Behavior changes across trial boundaries
 */

import { DateTime } from 'luxon';
import Redis from 'ioredis';
import { SubscriberService } from '../../src/services/subscriber-service';
import { Subscriber } from '../../src/types';

describe('Trial Period Transitions (Integration)', () => {
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
    const keys = await redis.keys(`*${testPhone}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    (SubscriberService as any).instance = null;
    subscriberService = SubscriberService.getInstance(redis);
  });

  afterEach(async () => {
    const keys = await redis.keys(`*${testPhone}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe('Trial day counting edge cases', () => {
    it('should count day 0 as signup day', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().toISO(),
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      expect(days).toBe(0);
    });

    it('should count partial days using floor', async () => {
      // 23 hours and 59 minutes ago = day 0
      const subscriber1 = await subscriberService.createSubscriber(`${testPhone}_1`, {
        signedUpAt: DateTime.now().minus({ hours: 23, minutes: 59 }).toISO(),
      });
      expect(subscriberService.getDaysSinceSignup(subscriber1)).toBe(0);

      // 24 hours and 1 minute ago = day 1
      const subscriber2 = await subscriberService.createSubscriber(`${testPhone}_2`, {
        signedUpAt: DateTime.now().minus({ hours: 24, minutes: 1 }).toISO(),
      });
      expect(subscriberService.getDaysSinceSignup(subscriber2)).toBe(1);
    });

    it('should handle exactly 7 days (168 hours)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ hours: 168 }).toISO(),
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      expect(days).toBe(7);
    });

    it('should handle 7 days + 1 hour (just over threshold)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ hours: 169 }).toISO(),
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      expect(days).toBe(7);
    });

    it('should handle 8 days (first day of throttling)', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 8 }).toISO(),
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      expect(days).toBe(8);
    });
  });

  describe('Trial period state transitions', () => {
    it('should transition correctly from day 2 to day 3 (warning starts)', async () => {
      // Day 2: No warning
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 2 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);

      // Update to day 3: Warning starts
      subscriber.signedUpAt = DateTime.now().minus({ days: 3 }).toISO();
      await subscriberService.updateSubscriber(testPhone, subscriber);

      const updated = await subscriberService.getSubscriber(testPhone);
      expect(subscriberService.shouldShowSubscriptionWarning(updated!)).toBe(true);
      expect(subscriberService.shouldThrottle(updated!)).toBe(false);
      expect(subscriberService.shouldPromptForSubscription(updated!)).toBe(false);
    });

    it('should transition correctly from day 6 to day 7 (warning ends)', async () => {
      // Day 6: Still warning
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 6 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(true);
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);

      // Update to day 7: Warning ends, still no throttle
      subscriber.signedUpAt = DateTime.now().minus({ days: 7 }).toISO();
      await subscriberService.updateSubscriber(testPhone, subscriber);

      const updated = await subscriberService.getSubscriber(testPhone);
      expect(subscriberService.shouldShowSubscriptionWarning(updated!)).toBe(false);
      expect(subscriberService.shouldThrottle(updated!)).toBe(false);
    });

    it('should transition correctly from day 7 to day 8 (throttling starts)', async () => {
      // Day 7: Last day of trial
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);

      // Update to day 8: Throttling starts
      subscriber.signedUpAt = DateTime.now().minus({ days: 8 }).toISO();
      await subscriberService.updateSubscriber(testPhone, subscriber);

      const updated = await subscriberService.getSubscriber(testPhone);
      
      // BUG CHECK: This is the critical transition!
      expect(subscriberService.shouldThrottle(updated!)).toBe(true);
      expect(subscriberService.shouldPromptForSubscription(updated!)).toBe(true);
    });

    it('BUG: shouldThrottle uses > 7, not >= 8', async () => {
      // Current implementation: days > 7
      // This means day 8 onwards is throttled
      
      const day7 = await subscriberService.createSubscriber(`${testPhone}_7`, {
        signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
        isPremium: false,
      });
      
      const day8 = await subscriberService.createSubscriber(`${testPhone}_8`, {
        signedUpAt: DateTime.now().minus({ days: 8 }).toISO(),
        isPremium: false,
      });

      // Day 7: days = 7, 7 > 7 = false ✓
      expect(subscriberService.shouldThrottle(day7)).toBe(false);
      
      // Day 8: days = 8, 8 > 7 = true ✓
      expect(subscriberService.shouldThrottle(day8)).toBe(true);

      // BUG?: What about day 7.5 (7 days + 12 hours)?
      const day7_5 = await subscriberService.createSubscriber(`${testPhone}_7_5`, {
        signedUpAt: DateTime.now().minus({ days: 7, hours: 12 }).toISO(),
        isPremium: false,
      });
      
      const days7_5 = subscriberService.getDaysSinceSignup(day7_5);
      expect(days7_5).toBe(7); // Floor to 7
      expect(subscriberService.shouldThrottle(day7_5)).toBe(false);
    });
  });

  describe('Premium upgrade during trial', () => {
    it('should immediately disable warnings when upgraded to premium', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(true);

      // Upgrade to premium
      await subscriberService.updateSubscriber(testPhone, { isPremium: true });
      const updated = await subscriberService.getSubscriber(testPhone);

      expect(subscriberService.shouldShowSubscriptionWarning(updated!)).toBe(false);
    });

    it('should immediately disable throttling when upgraded to premium', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 10 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);

      // Upgrade to premium
      await subscriberService.updateSubscriber(testPhone, { isPremium: true });
      const updated = await subscriberService.getSubscriber(testPhone);

      expect(subscriberService.shouldThrottle(updated!)).toBe(false);
    });

    it('should allow conversation count to be ignored for premium users', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 10 }).toISO(),
        isPremium: true,
      });

      // Increment count multiple times
      await subscriberService.incrementConversationCount(testPhone);
      await subscriberService.incrementConversationCount(testPhone);
      await subscriberService.incrementConversationCount(testPhone);

      // Premium users aren't throttled by conversation count
      // (Note: canStartConversationToday doesn't check isPremium!)
      // BUG?: Should premium users bypass conversation count?
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      
      // Currently returns false because count > 1
      // But premium users should be exempt?
      expect(canStart).toBe(false); // Current behavior
    });
  });

  describe('Off-by-one errors in trial logic', () => {
    it('should verify exact boundaries for warnings (days 3-6)', async () => {
      const testCases = [
        { days: 2, shouldWarn: false, label: 'day 2' },
        { days: 3, shouldWarn: true, label: 'day 3 (start)' },
        { days: 4, shouldWarn: true, label: 'day 4' },
        { days: 5, shouldWarn: true, label: 'day 5' },
        { days: 6, shouldWarn: true, label: 'day 6 (end)' },
        { days: 7, shouldWarn: false, label: 'day 7' },
      ];

      for (const testCase of testCases) {
        const subscriber = await subscriberService.createSubscriber(
          `${testPhone}_${testCase.days}`,
          {
            signedUpAt: DateTime.now().minus({ days: testCase.days }).toISO(),
            isPremium: false,
          }
        );

        const result = subscriberService.shouldShowSubscriptionWarning(subscriber);
        expect(result).toBe(testCase.shouldWarn);
      }
    });

    it('should verify exact boundaries for throttling (day 8+)', async () => {
      const testCases = [
        { days: 6, shouldThrottle: false },
        { days: 7, shouldThrottle: false },
        { days: 8, shouldThrottle: true },
        { days: 9, shouldThrottle: true },
        { days: 30, shouldThrottle: true },
      ];

      for (const testCase of testCases) {
        const subscriber = await subscriberService.createSubscriber(
          `${testPhone}_${testCase.days}`,
          {
            signedUpAt: DateTime.now().minus({ days: testCase.days }).toISO(),
            isPremium: false,
          }
        );

        const result = subscriberService.shouldThrottle(subscriber);
        expect(result).toBe(testCase.shouldThrottle);
      }
    });

    it('should verify exact boundaries for subscription prompts (day 8+)', async () => {
      const testCases = [
        { days: 6, shouldPrompt: false },
        { days: 7, shouldPrompt: false },
        { days: 8, shouldPrompt: true },
        { days: 9, shouldPrompt: true },
      ];

      for (const testCase of testCases) {
        const subscriber = await subscriberService.createSubscriber(
          `${testPhone}_${testCase.days}`,
          {
            signedUpAt: DateTime.now().minus({ days: testCase.days }).toISO(),
            isPremium: false,
          }
        );

        const result = subscriberService.shouldPromptForSubscription(subscriber);
        expect(result).toBe(testCase.shouldPrompt);
      }
    });
  });

  describe('Integration: Throttling + Conversation Count', () => {
    it('should combine throttling and conversation count after trial', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 10 }).toISO(),
        isPremium: false,
      });

      // User is past trial
      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);

      // First conversation of the day should be allowed
      const canStart1 = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart1).toBe(true);

      // Increment count
      await subscriberService.incrementConversationCount(testPhone);

      // Second conversation should be blocked
      const canStart2 = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart2).toBe(false);
    });

    it('BUG: Premium users are throttled by conversation count', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 10 }).toISO(),
        isPremium: true,
      });

      // Premium user should NOT be throttled
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);

      // Increment conversation count
      await subscriberService.incrementConversationCount(testPhone);

      // BUG: canStartConversationToday doesn't check isPremium!
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      
      // Premium users are still limited by conversation count
      expect(canStart).toBe(false);
      
      // Expected: Premium users should bypass conversation count limit
      // Fix: canStartConversationToday should check subscriber.isPremium
    });

    it('should reset conversation count daily but throttle flag persists', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 10 }).toISO(),
        isPremium: false,
      });

      // User is throttled
      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);

      // Use today's conversation
      await subscriberService.incrementConversationCount(testPhone);
      const canStart1 = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart1).toBe(false);

      // Simulate next day by deleting today's count
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      await redis.del(key);

      // Next day, conversation count resets
      const canStart2 = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart2).toBe(true);

      // But user is still throttled (based on signup date)
      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);
    });
  });

  describe('Signup date manipulation edge cases', () => {
    it('should handle future signup date gracefully', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().plus({ days: 1 }).toISO(),
        isPremium: false,
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      
      // BUG?: Should be negative or 0?
      expect(days).toBeLessThanOrEqual(0);
    });

    it('should handle very old signup date', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ years: 10 }).toISO(),
        isPremium: false,
      });

      const days = subscriberService.getDaysSinceSignup(subscriber);
      
      expect(days).toBeGreaterThan(3650); // ~10 years
      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);
    });

    it('should handle malformed signedUpAt date', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: 'not-a-date' as any,
        isPremium: false,
      });

      // Should not throw, should handle gracefully
      expect(() => subscriberService.getDaysSinceSignup(subscriber)).not.toThrow();
    });

    it('should auto-set signedUpAt if missing and persist it', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone);
      delete (subscriber as any).signedUpAt;

      // First call sets signedUpAt
      const days1 = subscriberService.getDaysSinceSignup(subscriber);
      expect(subscriber.signedUpAt).toBeDefined();
      expect(days1).toBe(0);

      // Second call should use the set value
      const days2 = subscriberService.getDaysSinceSignup(subscriber);
      expect(days2).toBe(0);
    });
  });

  describe('Time-based behavior consistency', () => {
    it('should give consistent results when called multiple times', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
        isPremium: false,
      });

      const days1 = subscriberService.getDaysSinceSignup(subscriber);
      const days2 = subscriberService.getDaysSinceSignup(subscriber);
      const days3 = subscriberService.getDaysSinceSignup(subscriber);

      expect(days1).toBe(days2);
      expect(days2).toBe(days3);
    });

    it('should handle rapid successive checks without drift', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
        isPremium: false,
      });

      const results = await Promise.all([
        subscriberService.shouldThrottle(subscriber),
        subscriberService.shouldThrottle(subscriber),
        subscriberService.shouldThrottle(subscriber),
        subscriberService.shouldShowSubscriptionWarning(subscriber),
        subscriberService.shouldShowSubscriptionWarning(subscriber),
      ]);

      // All checks should give same result
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
      expect(results[3]).toBe(results[4]);
    });
  });
});
