import { DateTime } from 'luxon';
import * as cron from 'node-cron'; // Import cron to mock it
import { SubscriberService } from '../subscriber/subscriber.service';
import { WhatsAppService } from '../../core/messaging/whatsapp';
import { DigestService } from '../digest/digest.service';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { logger, config } from '../../config'; // Import config for direct access in test
import { Subscriber } from '../subscriber/subscriber.types';

// Mock external modules
jest.mock('node-cron');
jest.mock('../subscriber/subscriber.service');
jest.mock('../../core/messaging/whatsapp', () => ({
  WhatsAppService: {
    getInstance: jest.fn(() => ({
      sendMessage: jest.fn(),
    })),
  },
}));
jest.mock('../digest/digest.service', () => ({
  DigestService: {
    getInstance: jest.fn(() => ({
      removeOldDigests: jest.fn(),
      createDigest: jest.fn(),
    })),
  },
}));
jest.mock('../../agents/language-buddy-agent');
jest.mock('../../config', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  },
  config: {
    features: {
      dailyMessages: {
        enabled: true,
        fuzzinessMinutes: 15, // Explicitly set to a number
        defaultWindows: {
          morning: { start: '08:00', end: '10:00' },
          midday: { start: '12:00', end: '14:00' },
          evening: { start: '18:00', end: '20:00' },
        },
      },
    },
  },
}));

const mockSubscriber: Subscriber = {
  connections: { phone: '1234567890' },
  profile: {
    name: 'Test User',
    learningLanguages: [],
    speakingLanguages: [],
    timezone: 'America/New_York',
    messagingPreferences: { type: 'morning', fuzzinessMinutes: 15 } // Added default messaging preferences
  },
  metadata: { digests: [], personality: 'friendly', streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() }, predictedChurnRisk: 0, engagementScore: 50, mistakeTolerance: 'normal' },
  isPremium: false,
  signedUpAt: '',
  lastActiveAt: new Date(),
  nextPushMessageAt: undefined,
};

// Dynamically import SchedulerService inside beforeEach
let SchedulerService: typeof import('./scheduler.service').SchedulerService;

describe('SchedulerService', () => {
  let scheduler: SchedulerService;
  let mockSubscriberService: jest.Mocked<SubscriberService>;
  let mockWhatsappService: jest.Mocked<WhatsAppService>;
  let mockDigestService: jest.Mocked<DigestService>;
  let mockLanguageBuddyAgent: jest.Mocked<LanguageBuddyAgent>;
  let mockCronSchedule: jest.Mock;

  beforeEach(() => {
    jest.isolateModules(() => {
      SchedulerService = jest.requireActual('./scheduler.service').SchedulerService;
    });
    
    jest.clearAllMocks();
    mockCronSchedule = cron.schedule as jest.Mock; // Cast to Mock
    // Mock getInstance calls for services that are directly instantiated inside SchedulerService
    (WhatsAppService.getInstance as jest.Mock).mockClear();
    (DigestService.getInstance as jest.Mock).mockClear();

    mockSubscriberService = {
      getAllSubscribers: jest.fn(),
      updateSubscriber: jest.fn(),
      incrementConversationCount: jest.fn(),
      createDigest: jest.fn(),
      shouldShowSubscriptionWarning: jest.fn(),
      getDailySystemPrompt: jest.fn(), // Added for executeNightlyTasksForSubscriber
    };
    mockWhatsappService = WhatsAppService.getInstance() as jest.Mocked<WhatsAppService>;
    mockDigestService = DigestService.getInstance() as jest.Mocked<DigestService>;
    mockLanguageBuddyAgent = {
      executeNightlyTasksForSubscriber: jest.fn(),
      clearConversation: jest.fn(),
      initiateConversation: jest.fn(),
    };

    scheduler = SchedulerService.getInstance(mockSubscriberService, mockLanguageBuddyAgent);

    // Mock implementations for services used within SchedulerService
    mockSubscriberService.getAllSubscribers.mockResolvedValue([mockSubscriber]);
    mockSubscriberService.updateSubscriber.mockResolvedValue(undefined);
    mockWhatsappService.sendMessage.mockResolvedValue({ failed: 0, total: 1 });
    mockLanguageBuddyAgent.executeNightlyTasksForSubscriber.mockResolvedValue('success'); // Default mock
    mockSubscriberService.getDailySystemPrompt.mockReturnValue('Daily System Prompt'); // Added mock return value
  });
  describe('calculateNextPushTime', () => {
    it('schedules next morning message in user timezone', () => {
      const now = DateTime.fromISO('2025-07-18T06:00:00', { zone: 'Europe/Berlin' });
      const subscriber: any = {
        profile: { timezone: 'Europe/Berlin', messagingPreferences: { type: 'morning', fuzzinessMinutes: config.features.dailyMessages.defaultWindows.fuzzinessMinutes } }
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
      const maxFuzziness = Math.min(config.features.dailyMessages.fuzzinessMinutes, 15);
      expect(next.toMillis()).toBeGreaterThanOrEqual(start.minus({ minutes: maxFuzziness }).toMillis());
      expect(next.toMillis()).toBeLessThanOrEqual(end.plus({ minutes: maxFuzziness }).toMillis());
      expect(next > now).toBe(true); // Must be in the future
    });

    it('schedules next fixed time correctly', () => {
      const now = DateTime.fromISO('2025-07-18T10:00:00', { zone: 'UTC' });
      const subscriber: any = {
        profile: { timezone: 'UTC', messagingPreferences: { type: 'fixed', times: ['11:00', '18:00'], fuzzinessMinutes: config.features.dailyMessages.defaultWindows.fuzzinessMinutes } }
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
        profile: { messagingPreferences: { type: 'morning', fuzzinessMinutes: config.features.dailyMessages.defaultWindows.fuzzinessMinutes } },
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

  describe('startSchedulers', () => {
    it('should schedule nightly digest and regular push message schedulers', () => {
      scheduler.startSchedulers();
      expect(mockCronSchedule).toHaveBeenCalledTimes(2);
      expect(mockCronSchedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
      expect(mockCronSchedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
    });
  });

  describe('processNightlyDigests', () => {
    const getMockSubscriberWithDigestRun = (): Subscriber => ({
      ...mockSubscriber,
      metadata: { ...mockSubscriber.metadata, lastNightlyDigestRun: '2025-01-01' },
      profile: { ...mockSubscriber.profile, timezone: 'America/New_York' }
    });
    const getMockSubscriberNoDigestRun = (): Subscriber => ({
      ...mockSubscriber,
      metadata: { ...mockSubscriber.metadata, lastNightlyDigestRun: undefined },
      profile: { ...mockSubscriber.profile, timezone: 'America/New_York' }
    });
    const getMockSubscriberDifferentTimezone = (): Subscriber => ({
      ...mockSubscriber,
      profile: { ...mockSubscriber.profile, timezone: 'Europe/Berlin' }
    });

    beforeEach(() => {
      // Reset isNightTimeForUser mock for each test within this describe block
      scheduler.isNightTimeForUser = jest.fn().mockReturnValue(false); // Default to false
      mockSubscriberService.getAllSubscribers.mockResolvedValue([
        getMockSubscriberWithDigestRun(),
        getMockSubscriberNoDigestRun(),
        getMockSubscriberDifferentTimezone()
      ]);
      mockLanguageBuddyAgent.executeNightlyTasksForSubscriber.mockResolvedValue('Digest message');
      // Ensure eligible for digest for tests that require it
      // Modifying a fresh object for the test
      const subscriberNoDigestRunInstance = getMockSubscriberNoDigestRun();
      subscriberNoDigestRunInstance.metadata.lastNightlyDigestRun = '2024-12-31';
      // Now ensure the mockSubscriberService returns this modified instance for relevant tests
      mockSubscriberService.getAllSubscribers.mockResolvedValue([
        getMockSubscriberWithDigestRun(),
        subscriberNoDigestRunInstance,
        getMockSubscriberDifferentTimezone()
      ]);
    });

    it('should not process if dailyMessages feature is disabled', async () => {
      config.features.dailyMessages.enabled = false;
      await (scheduler as any).processNightlyDigests();
      expect(mockSubscriberService.getAllSubscribers).not.toHaveBeenCalled();
      config.features.dailyMessages.enabled = true; // Reset
    });

    it('should not trigger digest if not 3 AM local time', async () => {
      (scheduler.isNightTimeForUser as jest.Mock).mockReturnValue(false); // Explicitly not 3 AM for this test
      await (scheduler as any).processNightlyDigests();
      expect(mockLanguageBuddyAgent.executeNightlyTasksForSubscriber).not.toHaveBeenCalled();
    });

    it('should not trigger digest if already run today', async () => {
      const subscriberWithDigestRunInstance = getMockSubscriberWithDigestRun();
      // Mock `isNightTimeForUser` to be true for the relevant subscriber, but lastDigestRunIso matches todayLocalIso
      (scheduler.isNightTimeForUser as jest.Mock).mockImplementation((sub, nowOverride) => {
        if (sub.connections.phone === subscriberWithDigestRunInstance.connections.phone) {
          return true; // Is 3 AM
        }
        return false;
      });
      // Ensure the mock subscriber has lastNightlyDigestRun matching nowLocal's toISODate
      const now = DateTime.local(2025, 1, 1, 3, 0, { zone: 'America/New_York' });
      jest.spyOn(DateTime, 'utc').mockReturnValue(now.toUTC());
      subscriberWithDigestRunInstance.metadata.lastNightlyDigestRun = now.toISODate(); // Make it run today

      mockSubscriberService.getAllSubscribers.mockResolvedValue([subscriberWithDigestRunInstance]);
      await (scheduler as any).processNightlyDigests();
      expect(mockLanguageBuddyAgent.executeNightlyTasksForSubscriber).not.toHaveBeenCalled();
    });

    it('should trigger digest for eligible subscribers and update metadata', async () => {
      const subscriberNoDigestRunInstance = getMockSubscriberNoDigestRun();
      // Mock `isNightTimeForUser` to return true for the eligible subscriber
      (scheduler.isNightTimeForUser as jest.Mock).mockImplementation((sub, nowOverride) => {
        const localHour = nowOverride.hour;
        const todayIso = nowOverride.toISODate();
        return sub.connections.phone === subscriberNoDigestRunInstance.connections.phone && localHour === 3 && subscriberNoDigestRunInstance.metadata.lastNightlyDigestRun !== todayIso;
      });

      mockSubscriberService.getAllSubscribers.mockResolvedValue([subscriberNoDigestRunInstance]);
      
      const now = DateTime.local(2025, 1, 1, 3, 0, { zone: 'America/New_York' });
      jest.spyOn(DateTime, 'utc').mockReturnValue(now.toUTC());

      await (scheduler as any).processNightlyDigests();

      expect(mockLanguageBuddyAgent.executeNightlyTasksForSubscriber).toHaveBeenCalledWith(subscriberNoDigestRunInstance);
      expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith(
        subscriberNoDigestRunInstance.connections.phone,
        expect.objectContaining({
          metadata: expect.objectContaining({
            lastNightlyDigestRun: now.toISODate()
          })
        })
      );
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
        phoneNumber: subscriberNoDigestRunInstance.connections.phone,
        localTime: now.toISO(),
      }), "Triggering nightly digest tasks for subscriber.");
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
        phoneNumber: subscriberNoDigestRunInstance.connections.phone,
      }), "Nightly digest tasks completed and lastNightlyDigestRun updated.");
    });

    it('should log error if executeNightlyTasksForSubscriber fails', async () => {
      const subscriberNoDigestRunInstance = getMockSubscriberNoDigestRun();
      // Mock `isNightTimeForUser` to return true
      (scheduler.isNightTimeForUser as jest.Mock).mockImplementation((sub, nowOverride) => {
        const localHour = nowOverride.hour;
        const todayIso = nowOverride.toISODate();
        return sub.connections.phone === subscriberNoDigestRunInstance.connections.phone && localHour === 3 && subscriberNoDigestRunInstance.metadata.lastNightlyDigestRun !== todayIso;
      });
      mockLanguageBuddyAgent.executeNightlyTasksForSubscriber.mockResolvedValue(null); // Simulate failure

      const now = DateTime.local(2025, 1, 1, 3, 0, { zone: 'America/New_York' });
      jest.spyOn(DateTime, 'utc').mockReturnValue(now.toUTC());
      mockSubscriberService.getAllSubscribers.mockResolvedValue([subscriberNoDigestRunInstance]);

      await (scheduler as any).processNightlyDigests();

      expect(mockLanguageBuddyAgent.executeNightlyTasksForSubscriber).toHaveBeenCalled();
      expect(mockSubscriberService.updateSubscriber).not.toHaveBeenCalledWith(
        subscriberNoDigestRunInstance.connections.phone,
        expect.objectContaining({
          metadata: expect.objectContaining({
            lastNightlyDigestRun: now.toISODate()
          })
        })
      );
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        phoneNumber: subscriberNoDigestRunInstance.connections.phone,
      }), "Nightly digest tasks failed for subscriber. Not updating lastNightlyDigestRun.");
    });
  });

  describe('processRegularPushMessages', () => {
    const mockSubscriberReadyForPush: Subscriber = {
      ...mockSubscriber,
      nextPushMessageAt: DateTime.utc().minus({ minutes: 5 }).toISO(), // 5 minutes in the past
      lastActiveAt: DateTime.utc().minus({ hours: 1 }).toJSDate(),
    };
    const mockSubscriberNotReadyForPush: Subscriber = {
      ...mockSubscriber,
      nextPushMessageAt: DateTime.utc().plus({ hours: 1 }).toISO(), // 1 hour in the future
    };
    const mockSubscriberNeedsReengagement: Subscriber = {
      ...mockSubscriber,
      nextPushMessageAt: DateTime.utc().minus({ minutes: 5 }).toISO(),
      lastActiveAt: DateTime.utc().minus({ days: 4 }).toJSDate(), // More than 3 days ago
    };
    const mockSubscriberWithWarning: Subscriber = {
      ...mockSubscriber,
      nextPushMessageAt: DateTime.utc().minus({ minutes: 5 }).toISO(),
    };

    beforeEach(() => {
      mockSubscriberService.getAllSubscribers.mockResolvedValue([
        mockSubscriberReadyForPush,
        mockSubscriberNotReadyForPush,
        mockSubscriberNeedsReengagement,
        mockSubscriberWithWarning,
      ]);
      mockSubscriberService.shouldShowSubscriptionWarning.mockReturnValue(false); // Default no warning
      scheduler.calculateNextPushTime = jest.fn().mockReturnValue(DateTime.utc().plus({ hours: 24 }));
      scheduler.shouldSendReengagementMessage = jest.fn(); // Mock this to control behavior
    });

    it('should not process if dailyMessages feature is disabled', async () => {
      config.features.dailyMessages.enabled = false;
      await (scheduler as any).processRegularPushMessages();
      expect(mockSubscriberService.getAllSubscribers).not.toHaveBeenCalled();
      config.features.dailyMessages.enabled = true; // Reset
    });

    it('should not send message if not time for next push', async () => {
      mockSubscriberService.getAllSubscribers.mockResolvedValue([mockSubscriberNotReadyForPush]);
      await (scheduler as any).processRegularPushMessages();
      expect(mockWhatsappService.sendMessage).not.toHaveBeenCalled();
    });

    it('should send re-engagement message if due and update nextPushMessageAt', async () => {
      mockSubscriberService.getAllSubscribers.mockResolvedValue([mockSubscriberNeedsReengagement]);
      (scheduler.shouldSendReengagementMessage as jest.Mock).mockReturnValue(true);

      const now = DateTime.utc();
      jest.spyOn(DateTime, 'utc').mockReturnValue(now);

      await (scheduler as any).processRegularPushMessages();

      expect(mockSubscriberService.getAllSubscribers).toHaveBeenCalled();
      expect(scheduler.shouldSendReengagementMessage).toHaveBeenCalledWith(
        mockSubscriberNeedsReengagement, expect.any(DateTime)
      );
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
        mockSubscriberNeedsReengagement.connections.phone,
        "Hey! It's been a while. Shall we continue our language practice?"
      );
      expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith(
        mockSubscriberNeedsReengagement.connections.phone,
        expect.objectContaining({ nextPushMessageAt: expect.any(String) })
      );
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
        phoneNumber: mockSubscriberNeedsReengagement.connections.phone,
      }), "Re-engagement message sent.");
    });

    it('should handle subscription warning and update nextPushMessageAt', async () => {
      mockSubscriberService.getAllSubscribers.mockResolvedValue([mockSubscriberWithWarning]);
      mockSubscriberService.shouldShowSubscriptionWarning.mockReturnValue(true);

      const now = DateTime.utc();
      jest.spyOn(DateTime, 'utc').mockReturnValue(now);

      await (scheduler as any).processRegularPushMessages();

      expect(mockSubscriberService.shouldShowSubscriptionWarning).toHaveBeenCalledWith(mockSubscriberWithWarning);
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
        mockSubscriberWithWarning.connections.phone,
        "⚠️ You have reached the maximum number of messages allowed for your plan. Please upgrade to continue chatting right now or come back tomorrow :)"
      );
      expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith(
        mockSubscriberWithWarning.connections.phone,
        expect.objectContaining({ nextPushMessageAt: now.plus({ hours: 24 }).toISO() })
      );
      expect(scheduler.calculateNextPushTime).not.toHaveBeenCalled(); // Should skip normal push logic
    });

    it('should update nextPushMessageAt and not send re-engagement if not due', async () => {
      mockSubscriberService.getAllSubscribers.mockResolvedValue([mockSubscriberReadyForPush]);
      (scheduler.shouldSendReengagementMessage as jest.Mock).mockReturnValue(false);
      
      const now = DateTime.utc();
      jest.spyOn(DateTime, 'utc').mockReturnValue(now);

      await (scheduler as any).processRegularPushMessages();

      expect(scheduler.shouldSendReengagementMessage).toHaveBeenCalled();
      expect(mockWhatsappService.sendMessage).not.toHaveBeenCalledWith(
        mockSubscriberReadyForPush.connections.phone,
        "Hey! It's been a while. Shall we continue our language practice?"
      );
      expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith(
        mockSubscriberReadyForPush.connections.phone,
        expect.objectContaining({ nextPushMessageAt: expect.any(String) })
      );
    });

    it('should log error during push message processing', async () => {
      mockSubscriberService.getAllSubscribers.mockRejectedValueOnce(new Error('DB Error'));
      await (scheduler as any).processRegularPushMessages();
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), "Error during regular push message processing");
    });
  });
});