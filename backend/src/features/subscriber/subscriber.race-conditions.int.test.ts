/**
 * Integration tests focused on conversation count tracking
 * Tests with REAL SQLite to catch bugs in:
 * - Redis key expiration timing
 * - Daily increments across timezone boundaries
 * - Race conditions on concurrent messages
 * - SET vs INCR logic bugs
 */

import { DateTime } from 'luxon';
import { SubscriberService } from './subscriber.service';
import { DatabaseService } from '../../core/database';
import { sanitizePhoneNumber } from './subscriber.utils';
import * as configModule from '../../core/config';

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

const mockedConfig = configModule.config as jest.Mocked<typeof configModule.config>;

describe('Conversation Count Tracking - Race Conditions (Integration)', () => {
  let dbService: DatabaseService;
  let subscriberService: SubscriberService;
  const testPhone = '+1234567890';

  beforeEach(async () => {
    dbService = new DatabaseService(':memory:');
    dbService.migrate();
    
    mockedConfig.test.skipStripeCheck = false;
    mockedConfig.test.phoneNumbers = [];

    (SubscriberService as any).instance = null;
    subscriberService = SubscriberService.getInstance(dbService);

    await subscriberService.createSubscriber(testPhone, {
      profile: {
        timezone: 'UTC'
      }
    });
  });

  afterEach(async () => {
    dbService.close();
  });

  describe('Race condition: Atomic increments', () => {
    it('should handle concurrent increments safely', async () => {
      const subscriber = await subscriberService.getSubscriber(testPhone);
      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);

      await Promise.all([
        subscriberService.incrementConversationCount(testPhone),
        subscriberService.incrementConversationCount(testPhone),
      ]);
      
      const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row = stmt.get(testPhone, today);
      
      expect(row?.conversation_start_count).toBe(2);
    });

    it('should handle multiple rapid increments correctly', async () => {
      const subscriber = await subscriberService.getSubscriber(testPhone);
      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(subscriberService.incrementConversationCount(testPhone));
      }
      
      await Promise.all(promises);
      
      const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row = stmt.get(testPhone, today);
      
      expect(row?.conversation_start_count).toBe(100);
    });
  });



  describe('Timezone edge cases', () => {
    it('should use subscriber timezone for date boundaries for counting', async () => {
      const subscriber = await subscriberService.getSubscriber(testPhone);
      if (!subscriber) throw new Error("Subscriber not found");

      // Set subscriber's timezone to a different one for this test
      await subscriberService.updateSubscriber(testPhone, { profile: { timezone: 'America/Los_Angeles' } });
      const laSubscriber = await subscriberService.getSubscriber(testPhone);
      if (!laSubscriber) throw new Error("LA Subscriber not found");

      // Increment a conversation count
      await subscriberService.incrementConversationCount(testPhone);

      // Verify the count in the database for the LA timezone's "today"
      const laToday = DateTime.now().setZone('America/Los_Angeles').toISODate();
      const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row = stmt.get(testPhone, laToday);
      
      expect(row?.conversation_start_count).toBe(1);

      // Ensure no count for UTC today if different
      const utcToday = DateTime.now().setZone('UTC').toISODate();
      if (laToday !== utcToday) {
        const utcRow = stmt.get(testPhone, utcToday);
        expect(utcRow).toBeUndefined(); // Should not have an entry for UTC today if different
      }
    });

    it('should handle date rollover at midnight in subscriber timezone', async () => {
      const subscriber = await subscriberService.getSubscriber(testPhone);
      if (!subscriber) throw new Error("Subscriber not found");

      // Simulate a past day's entry
      const pastDate = DateTime.now().setZone(subscriber.profile.timezone || 'UTC').minus({ days: 1 }).toISODate();
      const insertPastStmt = dbService.getDb().prepare(`
        INSERT INTO daily_usage (phone_number, usage_date, message_count, conversation_start_count, last_interaction_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(phone_number, usage_date) DO UPDATE SET conversation_start_count = ?
      `);
      insertPastStmt.run(testPhone, pastDate, 0, 5, new Date().toISOString(), 5);

      // Increment today
      await subscriberService.incrementConversationCount(testPhone);

      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber); // Get current "today"
      
      const pastStmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const pastCountRow = pastStmt.get(testPhone, pastDate);
      expect(pastCountRow?.conversation_start_count).toBe(5);

      const todayStmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const todayCountRow = todayStmt.get(testPhone, today);
      expect(todayCountRow?.conversation_start_count).toBe(1);
    });

    it('should correctly attribute conversation to the correct day despite timezones', async () => {
      // Setup subscriber with a timezone that crosses UTC midnight
      await subscriberService.updateSubscriber(testPhone, { profile: { timezone: 'Pacific/Kiritimati' } }); // UTC+14
      const kiribatiSubscriber = await subscriberService.getSubscriber(testPhone);
      if (!kiribatiSubscriber) throw new Error("Kiribati Subscriber not found");

      // Get "today" in Kiribati time
      const kiribatiToday = DateTime.now().setZone('Pacific/Kiritimati').toISODate();

      // Trigger conversation start
      await subscriberService.attemptToStartConversation(testPhone);

      // Check database for an entry on kiribatiToday
      const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row = stmt.get(testPhone, kiribatiToday);
      expect(row?.conversation_start_count).toBe(1);
    });
  });

  describe('Concurrent user access patterns', () => {
    it('should handle user sending multiple messages in quick succession', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      await subscriberService.incrementConversationCount(testPhone);
      await subscriberService.incrementConversationCount(testPhone);
      
      const subscriber = await subscriberService.getSubscriber(testPhone);
      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
      const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row = stmt.get(testPhone, today);
      
      expect(row?.conversation_start_count).toBe(3);
    });

    it('should handle check-then-act pattern correctly (non-atomic behavior)', async () => {
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
      
      await subscriberService.incrementConversationCount(testPhone);
      
      const canStartAgain = await subscriberService.canStartConversationToday(testPhone);
      expect(canStartAgain).toBe(false);
    });

    it('should prevent double spending using atomic attemptToStartConversation', async () => {
      const [result1, result2] = await Promise.all([
        subscriberService.attemptToStartConversation(testPhone),
        subscriberService.attemptToStartConversation(testPhone),
      ]);
      
      const successCount = (result1 ? 1 : 0) + (result2 ? 1 : 0);
      expect(successCount).toBe(1);
      
      const subscriber = await subscriberService.getSubscriber(testPhone);
      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
      const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row = stmt.get(testPhone, today);
      
      expect(row?.conversation_start_count).toBe(1);
    });
  });



  describe('Phone number handling', () => {
    it('should not collide with similar phone numbers', async () => {
      const phone1 = '+1234567890';
      const phone2 = '+12345678901'; 
      
      // Create subscribers first so their timezones are set, affecting daily_usage date keys
      await subscriberService.createSubscriber(phone1, { profile: { timezone: 'UTC' } });
      await subscriberService.createSubscriber(phone2, { profile: { timezone: 'UTC' } });

      await subscriberService.incrementConversationCount(phone1);
      await subscriberService.incrementConversationCount(phone2);
      
      const subscriber1 = await subscriberService.getSubscriber(phone1);
      const today1 = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber1);
      const stmt1 = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row1 = stmt1.get(sanitizePhoneNumber(phone1), today1);

      const subscriber2 = await subscriberService.getSubscriber(phone2);
      const today2 = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber2);
      const stmt2 = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row2 = stmt2.get(sanitizePhoneNumber(phone2), today2);
      
      expect(row1?.conversation_start_count).toBe(1);
      expect(row2?.conversation_start_count).toBe(1);
    });

    it('should handle special characters in phone number (after sanitization)', async () => {
      const phoneWithSpecial = '+1-234-567-8900';
      const sanitizedPhone = sanitizePhoneNumber(phoneWithSpecial);

      await subscriberService.createSubscriber(phoneWithSpecial, { profile: { timezone: 'UTC' } });
      await subscriberService.incrementConversationCount(phoneWithSpecial);
      
      const subscriber = await subscriberService.getSubscriber(sanitizedPhone);
      const today = (subscriberService as any)._getTodayInSubscriberTimezone(subscriber);
      const stmt = dbService.getDb().prepare('SELECT conversation_start_count FROM daily_usage WHERE phone_number = ? AND usage_date = ?');
      const row = stmt.get(sanitizedPhone, today);
      
      expect(row?.conversation_start_count).toBe(1);
    });
  });
});
