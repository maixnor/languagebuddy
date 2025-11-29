import { DateTime } from 'luxon';
import { SchedulerService } from './scheduler.service';
import { Subscriber } from '../../types';
import { config } from '../../config';

describe('SchedulerService', () => {
  let scheduler: SchedulerService;

  beforeAll(() => {
    // Mock dependencies as needed
    scheduler = Object.create(SchedulerService.prototype);
  });

  describe('calculateNextPushTime', () => {
    it('schedules next morning message in user timezone', () => {
      const now = DateTime.fromISO('2025-07-18T06:00:00', { zone: 'Europe/Berlin' });
      const subscriber: any = {
        profile: { timezone: 'Europe/Berlin', messagingPreferences: { type: 'morning' } }
      };
      const next = scheduler.calculateNextPushTime(subscriber, now);
      expect(next).toBeDefined();
      if (!next) throw new Error('next is undefined');
      const win = config.features.dailyMessages.defaultWindows.morning;
      const start = DateTime.fromFormat(win.start, 'HH:mm', { zone: 'Europe/Berlin' });
      const end = DateTime.fromFormat(win.end, 'HH:mm', { zone: 'Europe/Berlin' });
      
      // With the improved randomTimeInWindow function:
      // - Fuzziness is capped at 15 minutes (not the full 30 from config)
      // - Minimum window is 30 minutes
      // - Result is guaranteed to be in the future
      const maxFuzziness = Math.min(config.features.dailyMessages.defaultWindows.fuzzinessMinutes, 15);
      expect(next >= start.minus({ minutes: maxFuzziness }) && next <= end.plus({ minutes: maxFuzziness })).toBe(true);
      expect(next > now).toBe(true); // Must be in the future
    });

    it('schedules next fixed time correctly', () => {
      const now = DateTime.fromISO('2025-07-18T10:00:00', { zone: 'UTC' });
      const subscriber: any = {
        profile: { timezone: 'UTC', messagingPreferences: { type: 'fixed', times: ['11:00', '18:00'] } }
      };
      const next = scheduler.calculateNextPushTime(subscriber, now);
      expect(next).toBeDefined();
      if (!next) throw new Error('next is undefined');
      // Accept either 11:00 or 18:00 as valid next times
      const validHours = [11, 18];
      expect(validHours).toContain(next.hour);
    });

    it('defaults to UTC if timezone missing', () => {
      const now = DateTime.fromISO('2025-07-18T06:00:00', { zone: 'UTC' });
      const subscriber: any = {
        profile: { messagingPreferences: { type: 'morning' } },
      };
      const next = scheduler.calculateNextPushTime(subscriber, now);
      expect(next).toBeDefined();
      if (!next) throw new Error('next is undefined');
      expect(next.zoneName).toBe('UTC');
    });
  });

  describe('isNightTimeForUser', () => {
    let schedulerInstance: SchedulerService;

    beforeAll(() => {
      // Create a real instance as we are testing its own method
      schedulerInstance = Object.create(SchedulerService.prototype);
    });

    // Test case 1: It is 3 AM in the user's timezone
    it('should return true when it is 3 AM in the user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      const now = DateTime.fromISO('2025-01-01T03:30:00', { zone: 'America/New_York' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(true);
    });

    // Test case 2: It is not 3 AM in the user's timezone
    it('should return false when it is not 3 AM in the user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      const now = DateTime.fromISO('2025-01-01T04:00:00', { zone: 'America/New_York' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(false);
    });

    // Test case 3: Different timezone (Europe/Berlin) at 3 AM
    it('should return true for Europe/Berlin at 3 AM local time', () => {
      const subscriber = { profile: { timezone: 'Europe/Berlin' } };
      const now = DateTime.fromISO('2025-01-01T03:01:00', { zone: 'Europe/Berlin' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(true);
    });

    // Test case 4: Different timezone (Asia/Tokyo) outside 3 AM
    it('should return false for Asia/Tokyo outside 3 AM local time', () => {
      const subscriber = { profile: { timezone: 'Asia/Tokyo' } };
      const now = DateTime.fromISO('2025-01-01T05:00:00', { zone: 'Asia/Tokyo' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(false);
    });

    // Test case 5: Invalid timezone should default to UTC and return true for UTC 3 AM
    it('should default to UTC for invalid timezone and return true if UTC is 3 AM', () => {
      const subscriber = { profile: { timezone: 'Invalid/Timezone' } };
      const now = DateTime.fromISO('2025-01-01T03:00:00Z'); // UTC 3 AM
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(true);
    });

    // Test case 6: Invalid timezone should default to UTC and return false if UTC is not 3 AM
    it('should default to UTC for invalid timezone and return false if UTC is not 3 AM', () => {
      const subscriber = { profile: { timezone: 'Invalid/Timezone' } };
      const now = DateTime.fromISO('2025-01-01T04:00:00Z'); // UTC 4 AM
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(false);
    });

    // Edge case: Just before 3 AM
    it('should return false just before 3 AM in user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      const now = DateTime.fromISO('2225-01-01T02:59:59.999', { zone: 'America/New_York' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(false);
    });

    // Edge case: Exactly 3 AM
    it('should return true at exactly 3 AM in user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      const now = DateTime.fromISO('2225-01-01T03:00:00.000', { zone: 'America/New_York' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(true);
    });

    // Edge case: Just before 4 AM
    it('should return true just before 4 AM in user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      const now = DateTime.fromISO('2225-01-01T03:59:59.999', { zone: 'America/New_York' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(true);
    });

    // Edge case: Exactly 4 AM
    it('should return false at exactly 4 AM in user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      const now = DateTime.fromISO('2225-01-01T04:00:00.000', { zone: 'America/New_York' });
      expect(schedulerInstance.isNightTimeForUser(subscriber, now)).toBe(false);
    });
  });
});
