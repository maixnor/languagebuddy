import { DateTime } from 'luxon';
import Redis from 'ioredis';
import { SubscriberService } from '../../features/subscriber/subscriber.service';
import { SchedulerService } from '../scheduling/scheduler.service';
import { DigestService } from '../../features/digest/digest.service';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { Subscriber } from '../../features/subscriber/subscriber.types';

describe('SchedulerService - Digest Scheduler (Integration)', () => {
  let redis: Redis;
  let subscriberService: SubscriberService;
  let scheduler: SchedulerService;
  let digestService: DigestService;
  let agent: LanguageBuddyAgent;
  const testPhone = '+1987654321';

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear test data before each test
    const keys = await redis.keys(`*${testPhone}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    // Reset singleton instances for fresh state
    (SubscriberService as any).instance = null;
    (SchedulerService as any).instance = null;
    (DigestService as any).instance = null;
    
    subscriberService = SubscriberService.getInstance(redis);
    
    // Mock agent for testing (we don't want to actually call LLM in integration tests)
    agent = {
      clearConversation: jest.fn().mockResolvedValue(undefined),
      initiateConversation: jest.fn().mockResolvedValue('Welcome back!'),
    } as any;

    // Mock digest service to avoid LLM calls - THIS MUST BE DONE BEFORE SchedulerService IS INITIALIZED
    digestService = {
      getConversationHistory: jest.fn(),
      createConversationDigest: jest.fn(),
      saveDigestToSubscriber: jest.fn(),
      removeOldDigests: jest.fn().mockResolvedValue(0),
    } as any;
    // Mock getInstance to return our mocked digestService
    jest.spyOn(DigestService, 'getInstance').mockReturnValue(digestService);

    scheduler = SchedulerService.getInstance(subscriberService, agent);
  });

  afterEach(async () => {
    // Clean up test data after each test
    const keys = await redis.keys(`*${testPhone}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    jest.clearAllMocks();
  });

  describe('3 AM Digest Creation Flow', () => {
    it('should create digest, update profile, clear history, and schedule next push at 3 AM', async () => {
      // Create a test subscriber with timezone
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        profile: {
          name: 'Test User',
          timezone: 'UTC',
          speakingLanguages: [
            {
              languageName: 'English',
              overallLevel: 'C2',
              skillAssessments: [],
              deficiencies: [],
              firstEncountered: new Date(),
              lastPracticed: new Date(),
              totalPracticeTime: 0,
              confidenceScore: 100,
            },
          ],
          learningLanguages: [
            {
              languageName: 'Spanish',
              overallLevel: 'B1',
              skillAssessments: [],
              deficiencies: [],
              firstEncountered: new Date(),
              lastPracticed: new Date(),
              totalPracticeTime: 0,
              confidenceScore: 60,
            },
          ],
          messagingPreferences: {
            type: 'morning',
          },
        },
        signedUpAt: DateTime.now().minus({ days: 1 }).toISO(),
        lastDigestDate: undefined, // No digest yet
      });

      // Mock conversation history with 10 messages
      const mockHistory = Array(10).fill(null).map((_, i) => ({
        type: i % 2 === 0 ? 'human' : 'ai',
        content: `Message ${i + 1}`,
        timestamp: new Date().toISOString(),
      }));

      (digestService.getConversationHistory as jest.Mock).mockResolvedValue(mockHistory);

      // Mock digest creation
      const mockDigest = {
        timestamp: DateTime.now().toISO(),
        topic: 'Daily conversation practice',
        summary: 'User practiced basic Spanish conversation',
        keyBreakthroughs: ['Used past tense correctly'],
        areasOfStruggle: ['Subjunctive mood', 'Ser vs Estar'],
        vocabulary: {
          newWords: ['ayudar', 'necesitar'],
          reviewedWords: [],
          struggledWith: ['subjuntivo'],
          mastered: [],
        },
        phrases: {
          newPhrases: [],
          idioms: [],
          colloquialisms: [],
          formalExpressions: [],
        },
        grammar: {
          conceptsCovered: ['Past tense'],
          mistakesMade: ['Subjunctive conjugation', 'Gender agreement'],
          patternsPracticed: [],
        },
        conversationMetrics: {
          messagesExchanged: 10,
          averageResponseTime: 0,
          topicsDiscussed: [],
          userInitiatedTopics: 0,
          averageMessageLength: 0,
          sentenceComplexity: 0,
          punctuationAccuracy: 0,
          capitalizationAccuracy: 0,
          textCoherenceScore: 0,
          emojiUsage: 0,
          abbreviationUsage: [],
        },
        userMemos: ['Interested in travel Spanish'],
      };

      (digestService.createConversationDigest as jest.Mock).mockResolvedValue(mockDigest);

      // Simulate 3 AM check
      const nowUtc = DateTime.fromISO('2025-11-28T03:00:00', { zone: 'utc' });
      
      // Call the private method via prototype access
      const success = await (scheduler as any).create3AMDigestForSubscriber(subscriber);

      expect(success).toBe(true);
      
      // Verify digest was created
      expect(digestService.getConversationHistory).toHaveBeenCalledWith(testPhone);
      expect(digestService.createConversationDigest).toHaveBeenCalledWith(subscriber);
      expect(digestService.saveDigestToSubscriber).toHaveBeenCalledWith(subscriber, mockDigest);
      
      // Verify conversation was cleared
      expect(agent.clearConversation).toHaveBeenCalledWith(testPhone);
      
      // Verify old digests were cleaned up
      expect(digestService.removeOldDigests).toHaveBeenCalledWith(testPhone, 10);
      
      // Verify subscriber was updated with digest date and next push time
      const updatedSubscriber = await subscriberService.getSubscriber(testPhone);
      expect(updatedSubscriber?.lastDigestDate).toBe('2025-11-28');
      expect(updatedSubscriber?.nextPushMessageAt).toBeDefined();
      expect(updatedSubscriber?.lastMessageSentAt).toBeDefined();
      
      // Verify deficiencies were added to subscriber profile
      expect(updatedSubscriber?.profile.learningLanguages?.[0].deficiencies.length).toBeGreaterThan(0);
      const deficiencyAreas = updatedSubscriber?.profile.learningLanguages?.[0].deficiencies.map(d => d.specificArea);
      expect(deficiencyAreas).toContain('Subjunctive mood');
      expect(deficiencyAreas).toContain('Subjunctive conjugation');
    });

    it('should skip digest if conversation has less than 5 messages', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        profile: {
          name: 'Test User',
          timezone: 'UTC',
          speakingLanguages: [],
          learningLanguages: [],
        },
        lastDigestDate: undefined,
      });

      // Mock conversation history with only 3 messages
      const mockHistory = Array(3).fill(null).map((_, i) => ({
        type: i % 2 === 0 ? 'human' : 'ai',
        content: `Message ${i + 1}`,
        timestamp: new Date().toISOString(),
      }));

      (digestService.getConversationHistory as jest.Mock).mockResolvedValue(mockHistory);

      const success = await (scheduler as any).create3AMDigestForSubscriber(subscriber);

      expect(success).toBe(false);
      expect(digestService.createConversationDigest).not.toHaveBeenCalled();
      expect(agent.clearConversation).toHaveBeenCalledWith(testPhone); // Still clears conversation
      
      // Should still update digest date to prevent repeated checks
      const updatedSubscriber = await subscriberService.getSubscriber(testPhone);
      expect(updatedSubscriber?.lastDigestDate).toBeDefined();
    });

    it('should not create duplicate digests on same day', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        profile: {
          name: 'Test User',
          timezone: 'UTC',
          speakingLanguages: [],
          learningLanguages: [],
        },
        lastDigestDate: '2025-11-28', // Already created today
      });

      const nowUtc = DateTime.fromISO('2025-11-28T03:30:00', { zone: 'utc' });
      
      const shouldCreate = await (scheduler as any).shouldCreate3AMDigest(subscriber, nowUtc);
      
      expect(shouldCreate).toBe(false);
    });

    it('should handle timezone differences correctly for digest scheduling', async () => {
      // Test New York timezone (UTC-5)
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        profile: {
          name: 'Test User',
          timezone: 'America/New_York',
          speakingLanguages: [],
          learningLanguages: [],
        },
        lastDigestDate: '2025-11-27',
      });

      // 8 AM UTC = 3 AM EST
      const nowUtc = DateTime.fromISO('2025-11-28T08:00:00', { zone: 'utc' });
      
      const shouldCreate = await (scheduler as any).shouldCreate3AMDigest(subscriber, nowUtc);
      
      expect(shouldCreate).toBe(true);
    });

    it('should handle digest creation failure gracefully', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        profile: {
          name: 'Test User',
          timezone: 'UTC',
          speakingLanguages: [],
          learningLanguages: [],
        },
        lastDigestDate: undefined,
      });

      // Mock conversation history
      const mockHistory = Array(10).fill(null).map((_, i) => ({
        type: i % 2 === 0 ? 'human' : 'ai',
        content: `Message ${i + 1}`,
        timestamp: new Date().toISOString(),
      }));

      (digestService.getConversationHistory as jest.Mock).mockResolvedValue(mockHistory);
      (digestService.createConversationDigest as jest.Mock).mockResolvedValue(undefined); // Digest creation fails

      const success = await (scheduler as any).create3AMDigestForSubscriber(subscriber);

      expect(success).toBe(false);
      expect(agent.clearConversation).toHaveBeenCalledWith(testPhone); // Still clears conversation
      
      // Should still update digest date
      const updatedSubscriber = await subscriberService.getSubscriber(testPhone);
      expect(updatedSubscriber?.lastDigestDate).toBeDefined();
    });
  });

  describe('Profile Update from Digest', () => {
    it('should add deficiencies from digest areasOfStruggle', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        profile: {
          name: 'Test User',
          timezone: 'UTC',
          speakingLanguages: [],
          learningLanguages: [
            {
              languageName: 'French',
              overallLevel: 'A2',
              skillAssessments: [],
              deficiencies: [],
              firstEncountered: new Date(),
              lastPracticed: new Date(),
              totalPracticeTime: 0,
              confidenceScore: 40,
            },
          ],
        },
      });

      const mockDigest = {
        areasOfStruggle: ['Verb conjugations', 'Pronunciation'],
        grammar: {
          mistakesMade: ['Passé composé', 'Articles'],
          conceptsCovered: [],
          patternsPracticed: [],
        },
      };

      await (scheduler as any).updateSubscriberProfileFromDigest(subscriber, mockDigest);

      const updatedSubscriber = await subscriberService.getSubscriber(testPhone);
      const deficiencies = updatedSubscriber?.profile.learningLanguages?.[0].deficiencies || [];
      
      expect(deficiencies.length).toBeGreaterThan(0);
      
      const deficiencyAreas = deficiencies.map(d => d.specificArea);
      expect(deficiencyAreas).toContain('Verb conjugations');
      expect(deficiencyAreas).toContain('Pronunciation');
      expect(deficiencyAreas).toContain('Passé composé');
      expect(deficiencyAreas).toContain('Articles');
    });

    it('should handle missing learning language gracefully', async () => {
      const subscriber = await subscriberService.createSubscriber(testPhone, {
        profile: {
          name: 'Test User',
          timezone: 'UTC',
          speakingLanguages: [],
          learningLanguages: [], // No learning languages
        },
      });

      const mockDigest = {
        areasOfStruggle: ['Something'],
        grammar: {
          mistakesMade: ['Something else'],
          conceptsCovered: [],
          patternsPracticed: [],
        },
      };

      // Should not throw error
      await expect((scheduler as any).updateSubscriberProfileFromDigest(subscriber, mockDigest))
        .resolves.not.toThrow();
    });
  });

  describe('Re-engagement Message Logic', () => {
    it('should identify silent users after 3 days', async () => {
      const nowUtc = DateTime.fromISO('2025-11-28T12:00:00', { zone: 'utc' });
      const lastSent = DateTime.fromISO('2025-11-25T12:00:00', { zone: 'utc' }); // 3 days ago

      const subscriber = await subscriberService.createSubscriber(testPhone, {
        lastMessageSentAt: lastSent.toISO(),
      });

      const shouldSend = await (scheduler as any).shouldSendReengagementMessage(subscriber, nowUtc);
      
      expect(shouldSend).toBe(true);
    });

    it('should not send re-engagement within 3 days', async () => {
      const nowUtc = DateTime.fromISO('2025-11-28T12:00:00', { zone: 'utc' });
      const lastSent = DateTime.fromISO('2025-11-26T12:00:00', { zone: 'utc' }); // 2 days ago

      const subscriber = await subscriberService.createSubscriber(testPhone, {
        lastMessageSentAt: lastSent.toISO(),
      });

      const shouldSend = await (scheduler as any).shouldSendReengagementMessage(subscriber, nowUtc);
      
      expect(shouldSend).toBe(false);
    });
  });
});