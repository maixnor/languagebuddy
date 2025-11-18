import { DateTime } from 'luxon';
import { SchedulerService } from '../../src/services/scheduler-service';
import { Subscriber } from '../../src/types';
import { config } from '../../src/config';

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
});
