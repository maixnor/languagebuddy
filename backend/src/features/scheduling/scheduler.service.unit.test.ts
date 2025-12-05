import { DateTime } from 'luxon';
import * as cron from 'node-cron';
import { SchedulerService } from './scheduler.service';
import { SubscriberService } from '../subscriber/subscriber.service';
import { WhatsAppService } from '../../core/messaging/whatsapp';
import { DigestService } from '../digest/digest.service';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { logger, config } from '../../config';
import { Subscriber } from '../subscriber/subscriber.types';

// 1. Define Mocks
jest.mock('node-cron');
jest.mock('../subscriber/subscriber.service');
jest.mock('../../core/messaging/whatsapp');
jest.mock('../../config');
jest.mock('../digest/digest.service');
jest.mock('../../agents/language-buddy-agent');

describe('SchedulerService', () => {
  let SchedulerServiceClass: typeof SchedulerService;
  let scheduler: SchedulerService;

  // Mock instances
  let mockSubscriberService: jest.Mocked<SubscriberService>;
  let mockWhatsappService: jest.Mocked<WhatsAppService>;
  let mockDigestService: jest.Mocked<DigestService>;
  let mockLanguageBuddyAgent: jest.Mocked<LanguageBuddyAgent>;

  // Sample data
  const mockNow = DateTime.fromISO('2025-01-01T12:00:00Z');
  const mockSubscriber: Subscriber = {
    connections: { phone: '1234567890' },
    profile: {
      name: 'Test User',
      learningLanguages: [],
      speakingLanguages: [],
      timezone: 'America/New_York',
      messagingPreferences: { type: 'morning', fuzzinessMinutes: 15 }
    },
    metadata: {
        digests: [], 
        personality: 'friendly', 
        streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() }, 
        predictedChurnRisk: 0, 
        engagementScore: 50, 
        mistakeTolerance: 'normal' 
    },
    isPremium: false,
    signedUpAt: '',
    lastActiveAt: new Date(),
    nextPushMessageAt: undefined,
  };

  beforeAll(() => {
    // 2. Isolate modules to get a fresh SchedulerService class definition for the suite
    jest.isolateModules(() => {
        SchedulerServiceClass = require('./scheduler.service').SchedulerService;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(mockNow.toJSDate());

    // 3. Setup Mock Returns
    mockSubscriberService = {
        getAllSubscribers: jest.fn().mockResolvedValue([]),
        incrementConversationCount: jest.fn().mockResolvedValue(undefined),
        createDigest: jest.fn().mockResolvedValue(undefined),
        getDailySystemPrompt: jest.fn().mockReturnValue("Daily Prompt"),
        updateSubscriber: jest.fn().mockResolvedValue(undefined),
        shouldShowSubscriptionWarning: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<SubscriberService>;

    mockWhatsappService = {
        sendMessage: jest.fn().mockResolvedValue({ failed: 0 }),
    } as unknown as jest.Mocked<WhatsAppService>;
    (WhatsAppService.getInstance as jest.Mock).mockReturnValue(mockWhatsappService);

    mockDigestService = {
        removeOldDigests: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<DigestService>;
    (DigestService.getInstance as jest.Mock).mockReturnValue(mockDigestService);

    mockLanguageBuddyAgent = {
        clearConversation: jest.fn().mockResolvedValue(undefined),
        initiateConversation: jest.fn().mockResolvedValue("Hello there!"),
    } as unknown as jest.Mocked<LanguageBuddyAgent>;
    
    // Config mock
    (config as any).features = {
        dailyMessages: {
            enabled: true,
            fuzzinessMinutes: 15,
            defaultWindows: {
                morning: { start: '08:00', end: '10:00' },
                midday: { start: '12:00', end: '14:00' },
                evening: { start: '18:00', end: '20:00' },
            }
        }
    };

    // Reset singleton and instantiate
    (SchedulerServiceClass as any).instance = undefined;
    scheduler = SchedulerServiceClass.getInstance(mockSubscriberService, mockLanguageBuddyAgent);
  });

  afterEach(() => {
      jest.useRealTimers();
  });

  describe('startSchedulers', () => {
    it('should schedule nightly digest and regular push message schedulers', () => {
      scheduler.startSchedulers();
      expect(cron.schedule).toHaveBeenCalledTimes(2);
      expect(cron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
      expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
    });
  });

  describe('calculateNextPushTime', () => {
    it('schedules next morning message in user timezone', () => {
        // 06:00 Berlin time
        const now = DateTime.fromISO('2025-07-18T06:00:00', { zone: 'Europe/Berlin' });
        jest.setSystemTime(now.toJSDate());
        
        const subscriber: any = {
          profile: { timezone: 'Europe/Berlin', messagingPreferences: { type: 'morning', fuzzinessMinutes: 15 } }
        };
        
        const next = scheduler.calculateNextPushTime(subscriber, now);
        expect(next).toBeDefined();
        
        const win = config.features.dailyMessages.defaultWindows.morning;
        const start = DateTime.fromFormat(win.start, 'HH:mm', { zone: 'Europe/Berlin' }).set({ year: 2025, month: 7, day: 18 });
        const end = DateTime.fromFormat(win.end, 'HH:mm', { zone: 'Europe/Berlin' }).set({ year: 2025, month: 7, day: 18 });
        
        const fuzziness = 15;
        // Range: start - fuzziness to end + fuzziness
        const minTime = start.minus({ minutes: fuzziness });
        const maxTime = end.plus({ minutes: fuzziness });

        expect(next!.toMillis()).toBeGreaterThanOrEqual(minTime.toMillis());
        expect(next!.toMillis()).toBeLessThanOrEqual(maxTime.toMillis());
        expect(next! > now).toBe(true);
    });

    it('defaults to UTC if timezone missing or invalid', () => {
        const now = DateTime.fromISO('2025-07-18T06:00:00Z');
        const subscriber: any = {
          profile: { messagingPreferences: { type: 'morning' }, timezone: 'Invalid/Timezone' },
        };
        const next = scheduler.calculateNextPushTime(subscriber, now);
        expect(next).toBeDefined();
        expect(next!.zoneName).toBe('UTC');
    });
  });

  describe('isNightTimeForUser', () => {
    it('should return true when it is 3 AM in the user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      // 3:30 AM NY time
      const now = DateTime.fromISO('2025-01-01T03:30:00', { zone: 'America/New_York' });
      expect(scheduler.isNightTimeForUser(subscriber, now)).toBe(true);
    });

    it('should return false when it is not 3 AM in the user\'s timezone', () => {
      const subscriber = { profile: { timezone: 'America/New_York' } };
      const now = DateTime.fromISO('2025-01-01T04:00:00', { zone: 'America/New_York' });
      expect(scheduler.isNightTimeForUser(subscriber, now)).toBe(false);
    });
    
    it('should use system time if no override provided', () => {
        // Set system time to 3 AM NY time
        const nowNy = DateTime.fromObject({ hour: 3 }, { zone: 'America/New_York' });
        jest.setSystemTime(nowNy.toJSDate());
        
        const subscriber = { profile: { timezone: 'America/New_York' } };
        expect(scheduler.isNightTimeForUser(subscriber)).toBe(true);
    });
  });

  describe('executeNightlyTasksForSubscriber', () => {
      it('should execute all steps successfully', async () => {
          const result = await scheduler.executeNightlyTasksForSubscriber(mockSubscriber);
          
          expect(mockSubscriberService.incrementConversationCount).toHaveBeenCalledWith(mockSubscriber.connections.phone);
          expect(mockSubscriberService.createDigest).toHaveBeenCalledWith(mockSubscriber);
          expect(mockDigestService.removeOldDigests).toHaveBeenCalledWith(mockSubscriber.connections.phone, 10);
          expect(mockLanguageBuddyAgent.clearConversation).toHaveBeenCalledWith(mockSubscriber.connections.phone);
          expect(mockLanguageBuddyAgent.initiateConversation).toHaveBeenCalledWith(
              mockSubscriber, 
              "", // humanMessage is empty in this scenario as it's a system-initiated prompt
              "Daily Prompt" // systemPromptOverride
          );
          expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockSubscriber.connections.phone, "Hello there!");
          expect(result).toBe("Hello there!");
      });

      it('should continue if digest creation fails', async () => {
          mockSubscriberService.createDigest.mockRejectedValue(new Error("Digest failed"));
          
          await scheduler.executeNightlyTasksForSubscriber(mockSubscriber);
          
          // Should still proceed to clear conversation and send message
          expect(mockLanguageBuddyAgent.clearConversation).toHaveBeenCalled();
          expect(mockWhatsappService.sendMessage).toHaveBeenCalled();
          expect(logger.error).toHaveBeenCalledWith(
              expect.objectContaining({ err: expect.any(Error) }), 
              "Failed to create digest before conversation reset"
          );
      });

      it('should return null if message sending fails', async () => {
          mockWhatsappService.sendMessage.mockResolvedValue({ failed: 1, total: 1, success: 0 });
          
          const result = await scheduler.executeNightlyTasksForSubscriber(mockSubscriber);
          
          expect(result).toBeNull();
          expect(logger.error).toHaveBeenCalledWith(
              expect.objectContaining({ phoneNumber: mockSubscriber.connections.phone }),
              "Failed to send message after nightly tasks"
          );
      });
  });

  describe('processNightlyDigests', () => {
    it('should trigger digest for eligible subscribers', async () => {
        // Setup: User is in NY, current time is 3 AM NY
        const tz = 'America/New_York';
        const nowNy = DateTime.fromObject({ year: 2025, month: 1, day: 2, hour: 3, minute: 30 }, { zone: tz });
        jest.setSystemTime(nowNy.toJSDate());
        
        const eligibleSubscriber = {
            ...mockSubscriber,
            profile: { ...mockSubscriber.profile, timezone: tz },
            metadata: { ...mockSubscriber.metadata, lastNightlyDigestRun: '2025-01-01' } // Run yesterday
        };

        mockSubscriberService.getAllSubscribers.mockResolvedValue([eligibleSubscriber]);
        
        // Spy on the execution method to verify it's called
        const executeSpy = jest.spyOn(scheduler, 'executeNightlyTasksForSubscriber').mockResolvedValue("Message Sent");
        
        await (scheduler as any).processNightlyDigests();
        
        expect(executeSpy).toHaveBeenCalledWith(eligibleSubscriber);
        expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith(
            eligibleSubscriber.connections.phone,
            expect.objectContaining({
                metadata: expect.objectContaining({ 
                    lastNightlyDigestRun: expect.any(Date) 
                })
            })
        );
        // Verify the date part specifically
        const updatedSubscriberCall = mockSubscriberService.updateSubscriber.mock.calls[0];
        const updatedMetadata = updatedSubscriberCall[1].metadata;
        expect(DateTime.fromJSDate(updatedMetadata.lastNightlyDigestRun).toISODate()).toEqual('2025-01-02');

    });

    it('should skip if already run today', async () => {
        const tz = 'America/New_York';
        const nowNy = DateTime.fromObject({ year: 2025, month: 1, day: 2, hour: 3, minute: 30 }, { zone: tz });
        jest.setSystemTime(nowNy.toJSDate());
        
        const alreadyRunSubscriber = {
            ...mockSubscriber,
            profile: { ...mockSubscriber.profile, timezone: tz },
            metadata: { ...mockSubscriber.metadata, lastNightlyDigestRun: nowNy.toJSDate() } // Run today
        };

        mockSubscriberService.getAllSubscribers.mockResolvedValue([alreadyRunSubscriber]);
        const executeSpy = jest.spyOn(scheduler, 'executeNightlyTasksForSubscriber');

        await (scheduler as any).processNightlyDigests();
        
        expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe('processRegularPushMessages', () => {
    it('should send message if nextPushMessageAt is due', async () => {
        const now = DateTime.fromISO('2025-01-02T10:00:00Z').toUTC();
        jest.setSystemTime(now.toJSDate());

        const dueSubscriber = {
            ...mockSubscriber,
            nextPushMessageAt: now.minus({ minutes: 1 }).toISO(), // Due 1 min ago
            profile: { ...mockSubscriber.profile, timezone: 'UTC' }
        };

        mockSubscriberService.getAllSubscribers.mockResolvedValue([dueSubscriber]);
        
        // Mock calculateNextPushTime to return tomorrow
        const tomorrow = now.plus({ days: 1 }).toUTC();
        jest.spyOn(scheduler, 'calculateNextPushTime').mockReturnValue(tomorrow);
        
        // Should call calculateNextPushTime and updateSubscriber
        await (scheduler as any).processRegularPushMessages();
        
        expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith(
            dueSubscriber.connections.phone,
            expect.objectContaining({ 
                nextPushMessageAt: expect.any(Date)
            })
        );
        // Verify the date part specifically
        const updatedSubscriberCall = mockSubscriberService.updateSubscriber.mock.calls[0];
        const updatedSubscriberData = updatedSubscriberCall[1];
        expect(DateTime.fromJSDate(updatedSubscriberData.nextPushMessageAt).setZone('utc').toISO()).toEqual(tomorrow.toISO());


        
        // Should check for re-engagement
        // Default mock behavior for shouldSendReengagementMessage needs to be checked or mocked
        // The method is public, so we can spy on it? No, it's public so we can spy.
        // The default implementation checks lastMessageSentAt. 
        // Let's mock it to be sure.
        const reengageSpy = jest.spyOn(scheduler, 'shouldSendReengagementMessage').mockReturnValue(true);
        
        // We need to re-run because we spied after the fact? No, wait.
        // Ideally we setup spies before the call.
    });

    it('should send re-engagement message if needed', async () => {
        const now = DateTime.fromISO('2025-01-02T10:00:00Z');
        jest.setSystemTime(now.toJSDate());

        const dueSubscriber = {
            ...mockSubscriber,
            nextPushMessageAt: now.minus({ minutes: 1 }).toISO(),
        };

        mockSubscriberService.getAllSubscribers.mockResolvedValue([dueSubscriber]);
        jest.spyOn(scheduler, 'calculateNextPushTime').mockReturnValue(now.plus({ days: 1 }));
        jest.spyOn(scheduler, 'shouldSendReengagementMessage').mockReturnValue(true);

        await (scheduler as any).processRegularPushMessages();
        
        expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
            dueSubscriber.connections.phone,
            expect.stringContaining("It's been a while")
        );
    });
  });
});
