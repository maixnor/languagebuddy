// Mock DateTime.now to return a fixed date for consistent test results
const FIXED_DATE_ISO = '2025-01-01T12:00:00.000Z'; // This line is now uncommented
const fixedDateTime = jest.requireActual('luxon').DateTime.fromISO(FIXED_DATE_ISO);

jest.mock('luxon', () => {
  const actualLuxon = jest.requireActual('luxon');
  return {
    DateTime: {
      now: jest.fn(() => fixedDateTime), // Always return the pre-calculated fixed DateTime
      fromISO: actualLuxon.DateTime.fromISO,
      fromJSDate: jest.fn((jsDate: Date) => actualLuxon.DateTime.fromISO(jsDate.toISOString())), // Convert JS Date to ISO string then to Luxon DateTime
    },
  };
});

import { DateTime } from 'luxon';
import { SubscriberService } from './subscriber.service';
import { DatabaseService } from '../../core/database';
import { Subscriber } from './subscriber.types';
import { logger } from '../../core/config'; // Explicitly import logger
let configModule: typeof import('../../core/config');


let mockedConfig: jest.Mocked<typeof import('../../core/config').config>;

describe('Trial Period Transitions (Integration)', () => {
  let dbService: DatabaseService;
  let subscriberService: SubscriberService;
  const testPhone = '+1234567890';

  // Store original Date for restoration in afterEach
  let OriginalDate: typeof Date;

  beforeEach(async () => {
    configModule = jest.requireActual('../../core/config');
    mockedConfig = configModule.config as jest.Mocked<typeof configModule.config>;
    // Store original Date implementations
    OriginalDate = global.Date;

    // Mock DateTime.now for luxon
    (DateTime.now as jest.Mock).mockReturnValue(DateTime.fromISO(FIXED_DATE_ISO));

    // The fixed date instance for new Date() and Date.now()
    const MOCKED_DATE_INSTANCE = new OriginalDate(FIXED_DATE_ISO);

    // Create a mock Date class that extends the original Date
    class MockDate extends OriginalDate {
      constructor(dateString?: string | number | Date) {
        if (dateString) {
          super(dateString); // Call original Date constructor for specific dates
        } else {
          super(MOCKED_DATE_INSTANCE); // Default to fixed date for new Date()
        }
      }

      // Override static now() method
      static now(): number {
        return MOCKED_DATE_INSTANCE.valueOf();
      }
    }

    // Assign the mock Date class to global.Date
    global.Date = MockDate;

    dbService = new DatabaseService(':memory:');
    dbService.migrate();
    
    // Reset config for each test to ensure no leaks
    mockedConfig.test.skipStripeCheck = false;
    mockedConfig.test.phoneNumbers = [];

    (SubscriberService as any).instance = null;
    subscriberService = SubscriberService.getInstance(dbService);
  });

  afterEach(() => {
    dbService.close();
    jest.restoreAllMocks(); // Restore all mocks, including global.Date
    // Restore original Date implementations
    global.Date = OriginalDate;
    // We don't need to restore global.Date.now explicitly because it's part of global.Date
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
    it('should transition correctly from day 4 to day 5 (warning starts)', async () => {
      // Day 4: No warning
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 4 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(false);
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);
      expect(subscriberService.shouldPromptForSubscription(subscriber)).toBe(false);

      // Update to day 5: Warning starts
      subscriber.signedUpAt = DateTime.now().minus({ days: 5 }).toISO();
      await subscriberService.updateSubscriber(testPhone, subscriber);

      const updated = await subscriberService.getSubscriber(testPhone);
      expect(subscriberService.shouldShowSubscriptionWarning(updated!)).toBe(true);
      expect(subscriberService.shouldThrottle(updated!)).toBe(false);
      expect(subscriberService.shouldPromptForSubscription(updated!)).toBe(false);
    });

    it('should transition correctly from day 6 to day 7 (warning ends, throttling starts)', async () => {
      // Day 6: Warning active
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 6 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldShowSubscriptionWarning(subscriber)).toBe(true);
      expect(subscriberService.shouldThrottle(subscriber)).toBe(false);

      // Update to day 7: Warning ends, Throttling starts
      subscriber.signedUpAt = DateTime.now().minus({ days: 7 }).toISO();
      await subscriberService.updateSubscriber(testPhone, subscriber);

      const updated = await subscriberService.getSubscriber(testPhone);
      expect(subscriberService.shouldShowSubscriptionWarning(updated!)).toBe(false);
      expect(subscriberService.shouldThrottle(updated!)).toBe(true);
      expect(subscriberService.shouldPromptForSubscription(updated!)).toBe(true);
    });

    it('should correctly throttle from day 7 onwards', async () => {
      // Current implementation: days >= 7
      
      const day6 = await subscriberService.createSubscriber(`${testPhone}_6`, {
        signedUpAt: DateTime.now().minus({ days: 6 }).toISO(),
        isPremium: false,
      });
      
      const day7 = await subscriberService.createSubscriber(`${testPhone}_7`, {
        signedUpAt: DateTime.now().minus({ days: 7 }).toISO(),
        isPremium: false,
      });

      // Day 6: days = 6, 6 >= 7 = false
      expect(subscriberService.shouldThrottle(day6)).toBe(false);
      
      // Day 7: days = 7, 7 >= 7 = true
      expect(subscriberService.shouldThrottle(day7)).toBe(true);
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

      const canStart = await subscriberService.canStartConversationToday(testPhone);
      
      // Expected: Premium users should bypass conversation count limit
      // Currently the code logic (canStartConversationToday) allows premium users
      expect(canStart).toBe(true); 
    });
  });

  describe('Off-by-one errors in trial logic', () => {
    it('should verify exact boundaries for warnings (days 5-6)', async () => {
      const testCases = [
        { days: 4, shouldWarn: false, label: 'day 4' },
        { days: 5, shouldWarn: true, label: 'day 5 (start)' },
        { days: 6, shouldWarn: true, label: 'day 6 (end)' },
        { days: 7, shouldWarn: false, label: 'day 7' },
      ];

      for (const testCase of testCases) {
        const subscriber = await subscriberService.createSubscriber(
          `${testPhone}_warn_${testCase.days}`,
          {
            signedUpAt: DateTime.now().minus({ days: testCase.days }).toISO(),
            isPremium: false,
          }
        );

        const result = subscriberService.shouldShowSubscriptionWarning(subscriber);
        expect(result).toBe(testCase.shouldWarn);
      }
    });

    it('should verify exact boundaries for throttling (day 7+)', async () => {
      const testCases = [
        { days: 6, shouldThrottle: false },
        { days: 7, shouldThrottle: true },
        { days: 8, shouldThrottle: true },
        { days: 30, shouldThrottle: true },
      ];

      for (const testCase of testCases) {
        const subscriber = await subscriberService.createSubscriber(
          `${testPhone}_throttle_${testCase.days}`,
          {
            signedUpAt: DateTime.now().minus({ days: testCase.days }).toISO(),
            isPremium: false,
          }
        );

        const result = subscriberService.shouldThrottle(subscriber);
        expect(result).toBe(testCase.shouldThrottle);
      }
    });

    it('should verify exact boundaries for subscription prompts (day 7+)', async () => {
      const testCases = [
        { days: 6, shouldPrompt: false },
        { days: 7, shouldPrompt: true },
        { days: 8, shouldPrompt: true },
      ];

      for (const testCase of testCases) {
        const subscriber = await subscriberService.createSubscriber(
          `${testPhone}_prompt_${testCase.days}`,
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

      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);

      const canStart1 = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart1).toBe(true);

      await subscriberService.incrementConversationCount(testPhone);

      const canStart2 = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart2).toBe(false);
    });

    it('should reset conversation count daily but throttle flag persists', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        signedUpAt: DateTime.now().minus({ days: 10 }).toISO(),
        isPremium: false,
      });

      expect(subscriberService.shouldThrottle(subscriber)).toBe(true);

      await subscriberService.incrementConversationCount(testPhone, '2025-01-01'); // Pass fixed date
      const canStart1 = await subscriberService.canStartConversationToday(testPhone, '2025-01-01'); // Pass fixed date
      expect(canStart1).toBe(false);

      // Simulate next day by deleting today's count from SQLite
      const currentDay = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
      const deleteStmt = dbService.getDb().prepare('DELETE FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      deleteStmt.run(testPhone, currentDay);

      const canStart2 = await subscriberService.canStartConversationToday(testPhone, '2025-01-01'); // Pass fixed date
      expect(canStart2).toBe(true);

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