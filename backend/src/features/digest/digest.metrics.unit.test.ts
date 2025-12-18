import { DigestService } from './digest.service';
import { SubscriberService } from '../subscriber/subscriber.service';
import { DatabaseService } from '../../core/database';
import { ChatOpenAI } from "@langchain/openai";
import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { Subscriber } from '../subscriber/subscriber.types';
import { Digest } from './digest.types';
import { z } from 'zod';
import { StructuredTool } from "@langchain/core/tools";

// Mock deps
const mockLlm = {
  modelName: 'gpt-4-mock',
  withStructuredOutput: jest.fn(),
  invoke: jest.fn(),
} as unknown as ChatOpenAI;

const mockCheckpointer = {
  getTuple: jest.fn(),
} as unknown as BaseCheckpointSaver;

const mockSubscriberService = {
  getSubscriber: jest.fn(),
  updateSubscriber: jest.fn(),
} as unknown as SubscriberService;

describe('DigestService (Metrics Implementation)', () => {
  let digestService: DigestService;
  let subscriber: Subscriber;

  beforeEach(() => {
    (DigestService as any).instance = undefined;
    digestService = DigestService.getInstance(mockLlm, mockCheckpointer, mockSubscriberService);

    subscriber = {
      connections: { phone: '+1234567890' },
      profile: { 
        name: 'Test', 
        learningLanguages: [{ languageName: 'English', overallLevel: 'A1', skillAssessments: [], deficiencies: [], firstEncountered: new Date(), lastPracticed: new Date(), totalPracticeTime: 0, confidenceScore: 0, currentLanguage: true }], 
        speakingLanguages: [] 
      },
      metadata: { digests: [], personality: '', streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() }, predictedChurnRisk: 0, engagementScore: 0, mistakeTolerance: 'normal' },
      isPremium: true,
      status: 'active',
      signedUpAt: new Date(),
      lastActiveAt: new Date()
    } as Subscriber;

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should populate conversation metrics correctly', async () => {
    // Mock Checkpoint Data (Conversation History)
    const messages = [
      { id: ["langchain", "messages", "HumanMessage"], kwargs: { content: "Hello, how are you today?" } }, // 25 chars
      { id: ["langchain", "messages", "AIMessage"], kwargs: { content: "I am doing well, thank you! How about you?" } }, // 42 chars
      { id: ["langchain", "messages", "HumanMessage"], kwargs: { content: "I'm good. Do you like football? ⚽" } }, // 33 chars (including emoji)
      { id: ["langchain", "messages", "AIMessage"], kwargs: { content: "Yes, I enjoy sports. Football is exciting." } }, // 42 chars
      { id: ["langchain", "messages", "HumanMessage"], kwargs: { content: "Me too! lol" } } // 11 chars
    ];

    (mockCheckpointer.getTuple as jest.Mock).mockResolvedValue({
      checkpoint: { channel_values: { messages } }
    });

    // Mock LLM Response with new metrics object
    (mockLlm.withStructuredOutput as jest.Mock).mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        topic: 'Sports Talk',
        summary: 'Discussed football.',
        vocabulary: { newWords: ['offside'], reviewedWords: [], struggledWith: [], mastered: [] },
        phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
        grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
        keyBreakthroughs: [],
        areasOfStruggle: [],
        assistantMistakes: [],
        userMemos: [],
        metrics: {
            sentenceComplexity: 7.5,
            punctuationAccuracy: 85,
            capitalizationAccuracy: 90,
            abbreviationUsage: ['lol'],
            topicsDiscussed: ['football', 'sports']
        }
      })
    });

    // Mock Subscriber Service
    (mockSubscriberService.getSubscriber as jest.Mock).mockResolvedValue(subscriber);

    // Call createConversationDigest
    const digest = await digestService.createConversationDigest(subscriber);

    expect(digest).toBeDefined();
    if (!digest) return;

    const m = digest.conversationMetrics;

    // 1. Calculated by Code
    // Messages Exchanged
    expect(m.messagesExchanged).toBe(5);

    // Average Message Length: (25 + 42 + 33 + 42 + 11) / 5 = 153 / 5 = 30.6
    expect(m.averageMessageLength).toBeCloseTo(30.6, 1);

    // Emoji Usage (Calculated from messages)
    // Msg 3 has '⚽' -> 1 emoji
    expect(m.emojiUsage).toBe(1);


    // 2. Extracted from LLM
    expect(m.sentenceComplexity).toBe(7.5);
    expect(m.punctuationAccuracy).toBe(85);
    expect(m.capitalizationAccuracy).toBe(90);
    expect(m.abbreviationUsage).toContain('lol');
    expect(m.topicsDiscussed).toContain('football');
  });
});
