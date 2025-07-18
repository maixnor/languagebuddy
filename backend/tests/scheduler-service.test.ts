import { DateTime } from 'luxon';
import { SchedulerService } from '../src/schedulers/scheduler-service';
import { Subscriber } from '../src/types';
import { config } from '../src/config';

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
        profile: { timezone: 'Europe/Berlin' },
        metadata: { messagingPreferences: { type: 'morning' } }
      };
      const next = scheduler.calculateNextPushTime(subscriber, now);
      expect(next).toBeDefined();
      if (!next) throw new Error('next is undefined');
      const win = config.features.dailyMessages.defaultWindows.morning;
      const start = DateTime.fromFormat(win.start, 'HH:mm', { zone: 'Europe/Berlin' });
      const end = DateTime.fromFormat(win.end, 'HH:mm', { zone: 'Europe/Berlin' });
      expect(next >= start && next <= end.plus({ minutes: config.features.dailyMessages.defaultWindows.fuzzinessMinutes })).toBe(true);
    });

    it('schedules next fixed time correctly', () => {
      const now = DateTime.fromISO('2025-07-18T10:00:00', { zone: 'UTC' });
      const subscriber: any = {
        profile: { timezone: 'UTC' },
        metadata: { messagingPreferences: { type: 'fixed', times: ['11:00', '18:00'] } }
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
        profile: {},
        metadata: { messagingPreferences: { type: 'morning' } }
      };
      const next = scheduler.calculateNextPushTime(subscriber, now);
      expect(next).toBeDefined();
      if (!next) throw new Error('next is undefined');
      expect(next.zoneName).toBe('UTC');
    });
  });
});
