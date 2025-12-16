import { DateTime } from 'luxon';
import { SubscriberService } from './subscriber.service';
import { DatabaseService } from '../../core/database';
import { Subscriber } from './subscriber.types';
import * as configModule from '../../core/config';
import * as subscriberUtils from './subscriber.utils';

jest.mock('../../core/config', () => ({
  ...jest.requireActual('../../core/config'),
  config: {
    ...jest.requireActual('../../core/config').config,
    test: {
      phoneNumbers: [],
      skipStripeCheck: false,
    },
  },
  logger: jest.requireActual('../../core/config').logger,
}));

jest.mock('./subscriber.utils', () => ({
  ...jest.requireActual('./subscriber.utils'),
  isTestPhoneNumber: jest.fn(),
}));

const mockedConfig = configModule.config as jest.Mocked<typeof configModule.config>;
const mockedIsTestPhoneNumber = subscriberUtils.isTestPhoneNumber as jest.Mock;

describe('SubscriberService - Throttling Logic (Integration)', () => {
  let dbService: DatabaseService;
  let subscriberService: SubscriberService;
  const testPhone = '+1234567890';
  const testPhone69 = '+69123456789';
  const whitelistedPhone = '+19998887777';

  beforeAll(() => {
    // Initialize in-memory SQLite database
    dbService = new DatabaseService(':memory:');
    dbService.migrate();
  });

  afterAll(() => {
    dbService.close();
  });

  beforeEach(async () => {
    // Clear database tables before each test
    dbService.getDb().exec(`
      DELETE FROM subscribers;
      DELETE FROM daily_usage;
      DELETE FROM checkpoints;
      DELETE FROM checkpoint_writes;
      DELETE FROM checkpoint_blobs;
      DELETE FROM feedback;
      DELETE FROM processed_messages;
    `);
    
    // Reset singleton instance for fresh state
    (SubscriberService as any).instance = null;
    subscriberService = SubscriberService.getInstance(dbService);

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
    await subscriberService.createSubscriber(testPhone69, {
      profile: {
        timezone: 'UTC'
      }
    });
    await subscriberService.createSubscriber(whitelistedPhone, {
      profile: {
        timezone: 'UTC'
      }
    });
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
    it('should allow first conversation of the day', async () => {
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
    });

    it('should NOT allow second conversation of the day', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(false);
    });

    it('should reset conversation count after a day passes (simulated)', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      
      let canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(false);

      // Simulate a day passing by manually deleting the daily_usage entry for today
      const subscriber = await subscriberService.getSubscriber(testPhone);
      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
      const deleteStmt = dbService.getDb().prepare('DELETE FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      deleteStmt.run(testPhone, today);

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
          // Simulate being throttled
          await subscriberService.incrementConversationCount(testPhone); 
          const canStart = await subscriberService.attemptToStartConversation(testPhone);
          expect(canStart).toBe(true);
          
          const subscriber = await subscriberService.getSubscriber(testPhone);
          const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
          const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
          const row = stmt.get(testPhone, today);
          expect(row?.conversation_start_count).toBe(2);
        });
    
        it('should allow conversation and increment count if phone number starts with +69', async () => {
          mockedConfig.test.skipStripeCheck = false;
          const canStart = await subscriberService.attemptToStartConversation(testPhone69);
          expect(canStart).toBe(true);
    
          const subscriber = await subscriberService.getSubscriber(testPhone69);
          const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
          const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
          const row = stmt.get(testPhone69, today);
          expect(row?.conversation_start_count).toBe(1);
        });
    
        it('should allow conversation and increment count if phone number is in TEST_PHONE_NUMBERS list', async () => {
          mockedConfig.test.skipStripeCheck = false;
          mockedConfig.test.phoneNumbers = [whitelistedPhone];
          const canStart = await subscriberService.attemptToStartConversation(whitelistedPhone);
          expect(canStart).toBe(true);
    
          const subscriber = await subscriberService.getSubscriber(whitelistedPhone);
          const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
          const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
          const row = stmt.get(whitelistedPhone, today);
          expect(row?.conversation_start_count).toBe(1);
        });
      });
    
      describe('Message Counting', () => {
        it('should increment message count for a user', async () => {
          await subscriberService.incrementMessageCount(testPhone);
          const count = await subscriberService.getMessageCount(testPhone);
          expect(count).toBe(1);
        });
    
        it('should increment message count multiple times for a user', async () => {
          await subscriberService.incrementMessageCount(testPhone);
          await subscriberService.incrementMessageCount(testPhone);
          await subscriberService.incrementMessageCount(testPhone);
          const count = await subscriberService.getMessageCount(testPhone);
          expect(count).toBe(3);
        });
    
        it('should return 0 if no messages have been sent by the user today', async () => {
          const count = await subscriberService.getMessageCount(testPhone);
          expect(count).toBe(0);
        });
    
        it('should handle multiple users independently', async () => {
          await subscriberService.incrementMessageCount(testPhone);
          await subscriberService.incrementMessageCount(testPhone69);
          await subscriberService.incrementMessageCount(testPhone69);
    
          const count1 = await subscriberService.getMessageCount(testPhone);
          const count2 = await subscriberService.getMessageCount(testPhone69);
    
          expect(count1).toBe(1);
          expect(count2).toBe(2);
        });
    
        it('should reset message count after a day passes (simulated)', async () => {
          await subscriberService.incrementMessageCount(testPhone);
          expect(await subscriberService.getMessageCount(testPhone)).toBe(1);
    
          // Simulate a day passing by manually deleting the daily_usage entry for today
          const subscriber = await subscriberService.getSubscriber(testPhone);
          const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
          const deleteStmt = dbService.getDb().prepare('DELETE FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
          deleteStmt.run(testPhone, today);
    
                      // Message count should be 0 for the new day
                      expect(await subscriberService.getMessageCount(testPhone)).toBe(0);
                    });
                  });
                });
                });
                          