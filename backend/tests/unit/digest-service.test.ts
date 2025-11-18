import { DigestService } from '../../src/services/digest-service';
import { SubscriberService } from '../../src/services/subscriber-service';
import { Digest, Subscriber } from '../../src/types';
import Redis from 'ioredis';
import { ChatOpenAI } from '@langchain/openai';
import { RedisCheckpointSaver } from '../../src/persistence/redis-checkpointer';

// Mock Redis
jest.mock('ioredis');

describe('DigestService - Empty Digest Validation', () => {
  let digestService: DigestService;
  let subscriberService: jest.Mocked<SubscriberService>;
  let mockRedis: jest.Mocked<Redis>;
  let mockLLM: jest.Mocked<ChatOpenAI>;
  let mockCheckpointer: jest.Mocked<RedisCheckpointSaver>;
  
  const testSubscriber: Subscriber = {
    profile: {
      name: 'Test User',
      phoneNumber: '+1234567890',
      timezone: 'UTC',
      learningLanguages: [{
        languageName: 'German',
        overallLevel: 'A2',
        deficiencies: [],
        currentObjectives: [],
        lastPracticed: new Date(),
        totalPracticeTime: 0,
        skillAssessments: [],
        firstEncountered: new Date(),
        confidenceScore: 50
      }],
      speakingLanguages: []
    },
    connections: {
      phone: '+1234567890'
    },
    metadata: {
      digests: [],
      personality: 'friendly',
      streakData: {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: new Date()
      },
      predictedChurnRisk: 0,
      engagementScore: 50,
      difficultyPreference: 'adaptive'
    },
    isPremium: false,
    signedUpAt: new Date().toISOString()
  };

  beforeEach(() => {
    mockRedis = new Redis() as jest.Mocked<Redis>;
    mockLLM = {} as jest.Mocked<ChatOpenAI>;
    mockCheckpointer = {} as jest.Mocked<RedisCheckpointSaver>;
    
    subscriberService = {
      getSubscriber: jest.fn().mockResolvedValue(testSubscriber),
      updateSubscriber: jest.fn().mockResolvedValue(undefined)
    } as any;
    
    digestService = DigestService.getInstance(mockLLM, mockCheckpointer, subscriberService);
  });

  describe('saveDigestToSubscriber validation', () => {
    it('should throw error when topic is empty string', async () => {
      const emptyTopicDigest: Digest = {
        topic: '', // Empty string
        summary: 'Some summary',
        vocabulary: { newWords: [], struggledWith: [], mastered: [], reviewedWords: [] },
        grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
        phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
        keyBreakthroughs: [],
        areasOfStruggle: [],
        userMemos: [],
        conversationMetrics: {
          messagesExchanged: 0,
          averageResponseTime: 0,
          topicsDiscussed: [],
          userInitiatedTopics: 0,
          averageMessageLength: 0,
          sentenceComplexity: 0,
          punctuationAccuracy: 0,
          capitalizationAccuracy: 0,
          textCoherenceScore: 0,
          emojiUsage: 0,
          abbreviationUsage: []
        },
        timestamp: new Date().toISOString()
      };

      await expect(
        digestService.saveDigestToSubscriber(testSubscriber, emptyTopicDigest)
      ).rejects.toThrow(/empty.*invalid/i);
    });

    it('should throw error when topic is only whitespace', async () => {
      const whitespaceTopicDigest: Digest = {
        topic: '   ', // Only whitespace
        summary: 'Some summary',
        vocabulary: { newWords: [], struggledWith: [], mastered: [], reviewedWords: [] },
        grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
        phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
        keyBreakthroughs: [],
        areasOfStruggle: [],
        userMemos: [],
        conversationMetrics: {
          messagesExchanged: 0,
          averageResponseTime: 0,
          topicsDiscussed: [],
          userInitiatedTopics: 0,
          averageMessageLength: 0,
          sentenceComplexity: 0,
          punctuationAccuracy: 0,
          capitalizationAccuracy: 0,
          textCoherenceScore: 0,
          emojiUsage: 0,
          abbreviationUsage: []
        },
        timestamp: new Date().toISOString()
      };

      await expect(
        digestService.saveDigestToSubscriber(testSubscriber, whitespaceTopicDigest)
      ).rejects.toThrow(/empty.*invalid/i);
    });

    it('should throw error when summary is empty string', async () => {
      const emptySummaryDigest: Digest = {
        topic: 'Valid Topic',
        summary: '', // Empty string
        vocabulary: { newWords: [], struggledWith: [], mastered: [], reviewedWords: [] },
        grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
        phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
        keyBreakthroughs: [],
        areasOfStruggle: [],
        userMemos: [],
        conversationMetrics: {
          messagesExchanged: 0,
          averageResponseTime: 0,
          topicsDiscussed: [],
          userInitiatedTopics: 0,
          averageMessageLength: 0,
          sentenceComplexity: 0,
          punctuationAccuracy: 0,
          capitalizationAccuracy: 0,
          textCoherenceScore: 0,
          emojiUsage: 0,
          abbreviationUsage: []
        },
        timestamp: new Date().toISOString()
      };

      await expect(
        digestService.saveDigestToSubscriber(testSubscriber, emptySummaryDigest)
      ).rejects.toThrow(/empty.*invalid/i);
    });

    it('should throw error when summary is only whitespace', async () => {
      const whitespaceSummaryDigest: Digest = {
        topic: 'Valid Topic',
        summary: '   \n\t  ', // Only whitespace
        vocabulary: { newWords: [], struggledWith: [], mastered: [], reviewedWords: [] },
        grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
        phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
        keyBreakthroughs: [],
        areasOfStruggle: [],
        userMemos: [],
        conversationMetrics: {
          messagesExchanged: 0,
          averageResponseTime: 0,
          topicsDiscussed: [],
          userInitiatedTopics: 0,
          averageMessageLength: 0,
          sentenceComplexity: 0,
          punctuationAccuracy: 0,
          capitalizationAccuracy: 0,
          textCoherenceScore: 0,
          emojiUsage: 0,
          abbreviationUsage: []
        },
        timestamp: new Date().toISOString()
      };

      await expect(
        digestService.saveDigestToSubscriber(testSubscriber, whitespaceSummaryDigest)
      ).rejects.toThrow(/empty.*invalid/i);
    });

    it('should accept valid digest with non-empty topic and summary', async () => {
      const validDigest: Digest = {
        topic: 'German Dative Case',
        summary: 'Practiced using dative case with prepositions and indirect objects.',
        vocabulary: { 
          newWords: ['dem', 'der', 'den'], 
          struggledWith: [], 
          mastered: [], 
          reviewedWords: [] 
        },
        grammar: { 
          conceptsCovered: ['dative case'], 
          mistakesMade: ['used nominative instead of dative'],
          patternsPracticed: []
        },
        phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
        keyBreakthroughs: [],
        areasOfStruggle: [],
        userMemos: [],
        conversationMetrics: {
          messagesExchanged: 12,
          averageResponseTime: 30,
          topicsDiscussed: ['grammar'],
          userInitiatedTopics: 1,
          averageMessageLength: 50,
          sentenceComplexity: 2,
          punctuationAccuracy: 95,
          capitalizationAccuracy: 98,
          textCoherenceScore: 85,
          emojiUsage: 0,
          abbreviationUsage: []
        },
        timestamp: new Date().toISOString()
      };

      // Should not throw
      await digestService.saveDigestToSubscriber(testSubscriber, validDigest);
    });
  });
});
