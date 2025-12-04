import { DateTime } from 'luxon';
import { SchedulerService } from './scheduler.service';
import { SubscriberService } from '../subscriber/subscriber.service';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { config } from '../../config';

// Mock dependencies
jest.mock('../subscriber/subscriber.service');
jest.mock('../../core/messaging/whatsapp');
jest.mock('../../config');
jest.mock('../digest/digest.service');
jest.mock('../../agents/language-buddy-agent');

describe('SchedulerService Configuration Resilience', () => {
  let SchedulerServiceClass: typeof SchedulerService;
  let scheduler: SchedulerService;
  
  let mockSubscriberService: jest.Mocked<SubscriberService>;
  let mockLanguageBuddyAgent: jest.Mocked<LanguageBuddyAgent>;

  beforeAll(() => {
    jest.isolateModules(() => {
        SchedulerServiceClass = require('./scheduler.service').SchedulerService;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockSubscriberService = {} as unknown as jest.Mocked<SubscriberService>;
    mockLanguageBuddyAgent = {} as unknown as jest.Mocked<LanguageBuddyAgent>;

    // Reset singleton and instantiate
    (SchedulerServiceClass as any).instance = undefined;
    scheduler = SchedulerServiceClass.getInstance(mockSubscriberService, mockLanguageBuddyAgent);
  });

  it('should succeed with default fuzziness when config is missing fuzzinessMinutes', () => {
    // Simulate the BROKEN config structure where fuzzinessMinutes is missing from dailyMessages
    (config as any).features = {
        dailyMessages: {
            enabled: true,
            defaultWindows: {
                morning: { start: '07:00', end: '10:00' },
                midday: { start: '11:00', end: '14:00' },
                evening: { start: '18:00', end: '21:00' },
                fuzzinessMinutes: 30
            }
        }
    };

    const now = DateTime.fromISO('2025-01-01T08:00:00Z');
    const subscriber: any = {
        connections: { phone: '123' },
        profile: {
            timezone: 'UTC',
            messagingPreferences: { type: 'morning' } // No specific fuzziness in user prefs, so it falls back to config
        }
    };

    // This should NOT throw "Invalid unit value NaN" if the config is correct.
    // But currently it WILL throw because of the bug, making this a failing test.
    const nextPush = scheduler.calculateNextPushTime(subscriber, now);
    
    expect(nextPush).toBeDefined();
    expect(nextPush?.isValid).toBe(true);
  });
});
