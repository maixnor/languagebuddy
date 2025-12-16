import { DigestService } from '../../features/digest/digest.service';
import { SubscriberService } from '../../features/subscriber/subscriber.service';
import { Digest } from '../../features/digest/digest.types';
import { Subscriber, Language, LanguageDeficiency } from '../../features/subscriber/subscriber.types';

import { ChatOpenAI } from '@langchain/openai';
import { SqliteCheckpointSaver } from '../../core/persistence/sqlite-checkpointer';



describe('DigestService - Deficiency Practice Tracking', () => {
  let digestService: DigestService;
  let mockSubscriberService: jest.Mocked<SubscriberService>;
  let mockLLM: jest.Mocked<ChatOpenAI>;
  let mockCheckpointer: jest.Mocked<SqliteCheckpointSaver>;
  
  const createDeficiency = (
    specificArea: string,
    lastPracticedAt?: Date,
    practiceCount: number = 0
  ): LanguageDeficiency => ({
    category: 'grammar',
    specificArea,
    severity: 'moderate',
    frequency: 50,
    examples: [],
    improvementSuggestions: [],
    firstDetected: new Date('2024-01-01'),
    lastOccurrence: new Date('2024-01-15'),
    lastPracticedAt,
    practiceCount
  });

  const createSubscriber = (deficiencies: LanguageDeficiency[]): Subscriber => ({
    profile: {
      name: 'Test User',
      speakingLanguages: [],
      learningLanguages: [{
        languageName: 'German',
        overallLevel: 'A2',
        deficiencies,
        currentObjectives: [],
        lastPracticed: new Date(),
        totalPracticeTime: 0,
        skillAssessments: [],
        firstEncountered: new Date(),
        confidenceScore: 50
      }],
      timezone: 'UTC'
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
      difficultyPreference: 'adaptive',
      mistakeTolerance: 'normal'
    },
    isPremium: false,
    signedUpAt: new Date().toISOString()
  });

  const createDigest = (
    areasOfStruggle: string[] = [],
    grammarCovered: string[] = [],
    grammarMistakes: string[] = []
  ): Digest => ({
    timestamp: new Date().toISOString(),
    topic: 'Test Conversation',
    summary: 'A test conversation',
    keyBreakthroughs: [],
    areasOfStruggle,
    vocabulary: {
      newWords: [],
      reviewedWords: [],
      struggledWith: [],
      mastered: []
    },
    phrases: {
      newPhrases: [],
      idioms: [],
      colloquialisms: [],
      formalExpressions: []
    },
    grammar: {
      conceptsCovered: grammarCovered,
      mistakesMade: grammarMistakes,
      patternsPracticed: []
    },
    conversationMetrics: {
      messagesExchanged: 10,
      averageResponseTime: 30,
      topicsDiscussed: ['test'],
      userInitiatedTopics: 1,
      averageMessageLength: 50,
      sentenceComplexity: 5,
      punctuationAccuracy: 95,
      capitalizationAccuracy: 98,
      textCoherenceScore: 85,
      emojiUsage: 2,
      abbreviationUsage: []
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLLM = {} as jest.Mocked<ChatOpenAI>;
    mockCheckpointer = {} as jest.Mocked<SqliteCheckpointSaver>;
    
    mockSubscriberService = {
      getSubscriber: jest.fn(),
      updateSubscriber: jest.fn().mockResolvedValue(undefined)
    } as any;
    
    // Reset the singleton instance for testing
    (DigestService as any).instance = undefined;
    digestService = DigestService.getInstance(mockLLM, mockCheckpointer, mockSubscriberService);
  });

  it('should update lastPracticedAt when deficiency is mentioned in digest', async () => {
    const deficiency = createDeficiency('past tense', undefined, 0);
    const subscriber = createSubscriber([deficiency]);
    mockSubscriberService.getSubscriber.mockResolvedValue(subscriber);

    const digest = createDigest(['past tense'], ['past tense conjugation'], []);
    
    await digestService.saveDigestToSubscriber(subscriber, digest);

    expect(mockSubscriberService.updateSubscriber).toHaveBeenCalled();
    const updatedSubscriber = mockSubscriberService.updateSubscriber.mock.calls[0][1];
    const updatedDeficiency = updatedSubscriber.profile.learningLanguages[0].deficiencies[0];
    
    expect(updatedDeficiency.lastPracticedAt).toBeDefined();
    expect(updatedDeficiency.practiceCount).toBe(1);
  });

  it('should increment practiceCount when deficiency is practiced multiple times', async () => {
    const deficiency = createDeficiency('verb conjugation', new Date('2024-01-10'), 2);
    const subscriber = createSubscriber([deficiency]);
    mockSubscriberService.getSubscriber.mockResolvedValue(subscriber);

    const digest = createDigest([], ['verb conjugation'], ['verb conjugation errors']);
    
    await digestService.saveDigestToSubscriber(subscriber, digest);

    const updatedSubscriber = mockSubscriberService.updateSubscriber.mock.calls[0][1];
    const updatedDeficiency = updatedSubscriber.profile.learningLanguages[0].deficiencies[0];
    
    expect(updatedDeficiency.practiceCount).toBe(3);
  });

  it('should match deficiencies with fuzzy matching', async () => {
    const deficiency = createDeficiency('article usage', undefined, 0);
    const subscriber = createSubscriber([deficiency]);
    mockSubscriberService.getSubscriber.mockResolvedValue(subscriber);

    // Digest mentions "article" which should match "article usage"
    const digest = createDigest(['article mistakes'], ['article rules'], []);
    
    await digestService.saveDigestToSubscriber(subscriber, digest);

    const updatedSubscriber = mockSubscriberService.updateSubscriber.mock.calls[0][1];
    const updatedDeficiency = updatedSubscriber.profile.learningLanguages[0].deficiencies[0];
    
    expect(updatedDeficiency.lastPracticedAt).toBeDefined();
    expect(updatedDeficiency.practiceCount).toBe(1);
  });

  it('should not update deficiency if not mentioned in digest', async () => {
    const deficiency = createDeficiency('past tense', undefined, 0);
    const subscriber = createSubscriber([deficiency]);
    mockSubscriberService.getSubscriber.mockResolvedValue(subscriber);

    const digest = createDigest(['vocabulary mistakes'], ['adjective endings'], []);
    
    await digestService.saveDigestToSubscriber(subscriber, digest);

    const updatedSubscriber = mockSubscriberService.updateSubscriber.mock.calls[0][1];
    const updatedDeficiency = updatedSubscriber.profile.learningLanguages[0].deficiencies[0];
    
    expect(updatedDeficiency.lastPracticedAt).toBeUndefined();
    expect(updatedDeficiency.practiceCount).toBe(0);
  });

  it('should add new deficiency if not already tracked', async () => {
    const existingDeficiency = createDeficiency('past tense', undefined, 0);
    const subscriber = createSubscriber([existingDeficiency]);
    mockSubscriberService.getSubscriber.mockResolvedValue(subscriber);

    const digest = createDigest(['subjunctive mood'], [], []);
    
    await digestService.saveDigestToSubscriber(subscriber, digest);

    const updatedSubscriber = mockSubscriberService.updateSubscriber.mock.calls[0][1];
    const deficiencies = updatedSubscriber.profile.learningLanguages[0].deficiencies;
    
    expect(deficiencies).toHaveLength(2);
    expect(deficiencies[1].specificArea).toBe('subjunctive mood');
    expect(deficiencies[1].practiceCount).toBe(0);
  });

  it('should not add duplicate deficiency if already tracked', async () => {
    const existingDeficiency = createDeficiency('past tense', undefined, 0);
    const subscriber = createSubscriber([existingDeficiency]);
    mockSubscriberService.getSubscriber.mockResolvedValue(subscriber);

    const digest = createDigest(['past tense'], [], []);
    
    await digestService.saveDigestToSubscriber(subscriber, digest);

    const updatedSubscriber = mockSubscriberService.updateSubscriber.mock.calls[0][1];
    const deficiencies = updatedSubscriber.profile.learningLanguages[0].deficiencies;
    
    // Should still have only 1 deficiency (updated, not duplicated)
    expect(deficiencies).toHaveLength(1);
    expect(deficiencies[0].practiceCount).toBe(1);
  });

  it('should track multiple deficiencies practiced in same conversation', async () => {
    const def1 = createDeficiency('past tense', undefined, 0);
    const def2 = createDeficiency('articles', undefined, 0);
    const def3 = createDeficiency('word order', undefined, 0);
    const subscriber = createSubscriber([def1, def2, def3]);
    mockSubscriberService.getSubscriber.mockResolvedValue(subscriber);

    const digest = createDigest(
      ['past tense', 'articles'],
      ['past tense', 'article usage'],
      []
    );
    
    await digestService.saveDigestToSubscriber(subscriber, digest);

    const updatedSubscriber = mockSubscriberService.updateSubscriber.mock.calls[0][1];
    const deficiencies = updatedSubscriber.profile.learningLanguages[0].deficiencies;
    
    // First two should be updated
    expect(deficiencies[0].practiceCount).toBe(1);
    expect(deficiencies[1].practiceCount).toBe(1);
    // Third should remain unchanged
    expect(deficiencies[2].practiceCount).toBe(0);
  });
});