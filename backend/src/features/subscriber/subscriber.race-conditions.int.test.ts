/**
 * Integration tests focused on conversation count tracking
 * Tests with REAL Redis to catch bugs in:
 * - Redis key expiration timing
 * - Daily increments across timezone boundaries
 * - Race conditions on concurrent messages
 * - SET vs INCR logic bugs
 */

import { DateTime } from 'luxon';
import Redis from 'ioredis';
import { SubscriberService } from './subscriber.service';

describe('Conversation Count Tracking - Race Conditions (Integration)', () => {
  let redis: Redis;
  let subscriberService: SubscriberService;
  const testPhone = '+1234567890';

  beforeEach(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
    // Clear ALL conversation count test data
    const keys = await redis.keys(`conversation_count:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    (SubscriberService as any).instance = null;
    subscriberService = SubscriberService.getInstance(redis);
  });

  afterEach(async () => {
    // Clean up Redis after each test
    const keys = await redis.keys(`*${testPhone}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  describe('Race condition: SET vs INCR', () => {
    it('should handle concurrent increments safely (Atomic INCR)', async () => {
      // With atomic Lua script, this should always result in 2
      
      const results = await Promise.all([
        subscriberService.incrementConversationCount(testPhone),
        subscriberService.incrementConversationCount(testPhone),
      ]);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      console.log('Concurrent INCR test - Count:', count);
      expect(count).toBe('2');
    });

    it('should handle multiple rapid increments correctly', async () => {
      // Hammer the increment with 100 concurrent calls
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(subscriberService.incrementConversationCount(testPhone));
      }
      
      await Promise.all(promises);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      console.log('100 concurrent increments - Count:', count);
      
      // Should be exactly 100
      expect(count).toBe('100');
    });
  });

  describe('Redis TTL behavior', () => {
    it('should preserve TTL when using INCR after SET', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      
      const ttl1 = await redis.ttl(key);
      expect(ttl1).toBeGreaterThan(86000);
      
      // Wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Increment again
      await subscriberService.incrementConversationCount(testPhone);
      
      const ttl2 = await redis.ttl(key);
      
      // BUG CHECK: INCR should NOT reset TTL
      // TTL should be 2-3 seconds less than original
      expect(ttl2).toBeLessThan(ttl1);
      expect(ttl2).toBeGreaterThan(86000 - 10); // Allow 10s margin
    });

    it('should expire key after 24 hours', async () => {
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      
      // Manually set TTL to 1 second for testing
      await redis.expire(key, 1);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const exists = await redis.exists(key);
      expect(exists).toBe(0);
      
      // Should allow conversation again
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
    });

    it('should ensure TTL is set even if key exists without one', async () => {
      // If key exists without TTL (e.g. created by raw INCR),
      // our logic should detect it and set TTL
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      
      // Simulate race: manually INCR before our code runs
      await redis.incr(key);
      
      // Now run our increment logic
      await subscriberService.incrementConversationCount(testPhone);
      
      const ttl = await redis.ttl(key);
      
      // TTL should be set
      expect(ttl).not.toBe(-1);
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe('Timezone edge cases', () => {
    it('should use server timezone for date boundaries', async () => {
      const serverNow = DateTime.now();
      const tokyoNow = DateTime.now().setZone('Asia/Tokyo');
      const nyNow = DateTime.now().setZone('America/New_York');
      
      console.log('Server date:', serverNow.toISODate());
      console.log('Tokyo date:', tokyoNow.toISODate());
      console.log('NY date:', nyNow.toISODate());
      
      // BUG: If server and user are in different timezones,
      // the "day" might be different!
      
      await subscriberService.incrementConversationCount(testPhone);
      
      const serverKey = `conversation_count:${testPhone}:${serverNow.toISODate()}`;
      const serverCount = await redis.get(serverKey);
      
      expect(serverCount).toBe('1');
      
      // If dates differ, user's "today" might be server's "yesterday" or "tomorrow"
    });

    it('should handle date rollover at midnight', async () => {
      // Set count for "yesterday"
      const yesterday = DateTime.now().minus({ days: 1 }).toISODate();
      const yesterdayKey = `conversation_count:${testPhone}:${yesterday}`;
      await redis.set(yesterdayKey, '5', 'EX', 86400);
      
      // Increment today
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const todayKey = `conversation_count:${testPhone}:${today}`;
      const todayCount = await redis.get(todayKey);
      
      // Should be 1 (new day), not 6
      expect(todayCount).toBe('1');
      
      // Yesterday's count should still exist
      const yesterdayCount = await redis.get(yesterdayKey);
      expect(yesterdayCount).toBe('5');
    });

    it('should handle user near midnight in their timezone', async () => {
      // User in Tokyo at 11:59 PM, server in UTC (different date)
      // BUG POTENTIAL: User might be throttled incorrectly
      
      // This is a documentation test - actual fix would require
      // storing user timezone and using it for date calculations
      
      const serverDate = DateTime.now().toISODate();
      const userDate = DateTime.now().setZone('Asia/Tokyo').toISODate();
      
      if (serverDate !== userDate) {
        console.warn('BUG: Server and user timezone dates differ!', {
          serverDate,
          userDate,
        });
      }
    });
  });

  describe('Concurrent user access patterns', () => {
    it('should handle user sending multiple messages in quick succession', async () => {
      // Real-world: User sends 3 messages within 1 second
      
      await subscriberService.incrementConversationCount(testPhone);
      await subscriberService.incrementConversationCount(testPhone);
      await subscriberService.incrementConversationCount(testPhone);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      expect(count).toBe('3');
    });

    it('should handle check-then-act pattern correctly', async () => {
      // Pattern: Check if can start, then increment
      // This is NOT atomic - race condition possible
      
      const canStart = await subscriberService.canStartConversationToday(testPhone);
      expect(canStart).toBe(true);
      
      await subscriberService.incrementConversationCount(testPhone);
      
      const canStartAgain = await subscriberService.canStartConversationToday(testPhone);
      expect(canStartAgain).toBe(false);
    });

    it('should prevent double spending using atomic attemptToStartConversation', async () => {
      // Two requests attempt to start simultaneously
      const [result1, result2] = await Promise.all([
        subscriberService.attemptToStartConversation(testPhone),
        subscriberService.attemptToStartConversation(testPhone),
      ]);
      
      // Only one should succeed
      const successCount = (result1 ? 1 : 0) + (result2 ? 1 : 0);
      expect(successCount).toBe(1);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${testPhone}:${today}`;
      const count = await redis.get(key);
      
      expect(count).toBe('1');
    });
  });

  describe('Redis connection issues', () => {
    it('should handle Redis being temporarily unavailable', async () => {
      // Simulate Redis down by creating new disconnected instance
      const badRedis = new Redis({
        host: 'nonexistent-host',
        port: 9999,
        retryStrategy: () => null, // Don't retry
        lazyConnect: true,
      });
      
      (SubscriberService as any).instance = null;
      const badService = SubscriberService.getInstance(badRedis);
      
      // Should not hang or throw unhandled error
      try {
        await badService.canStartConversationToday(testPhone);
      } catch (err) {
        // Expected to fail, but should be caught
        expect(err).toBeDefined();
      }
      
      // badRedis will be garbage collected.
    });
  });

  describe('Key naming and collision', () => {
    it('should not collide with similar phone numbers', async () => {
      const phone1 = '1234567890';
      const phone2 = '12345678901'; // One extra digit
      
      await subscriberService.incrementConversationCount(phone1);
      await subscriberService.incrementConversationCount(phone2);
      
      const today = DateTime.now().toISODate();
      const key1 = `conversation_count:${phone1}:${today}`;
      const key2 = `conversation_count:${phone2}:${today}`;
      
      const count1 = await redis.get(key1);
      const count2 = await redis.get(key2);
      
      expect(count1).toBe('1');
      expect(count2).toBe('1');
    });

    it('should handle special characters in phone number', async () => {
      const phoneWithSpecial = '+1-234-567-8900';
      
      await subscriberService.incrementConversationCount(phoneWithSpecial);
      
      const today = DateTime.now().toISODate();
      const key = `conversation_count:${phoneWithSpecial}:${today}`;
      const count = await redis.get(key);
      
      expect(count).toBe('1');
    });
  });
});
