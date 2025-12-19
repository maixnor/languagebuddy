import { ChatOpenAI } from '@langchain/openai';
import { BaseCheckpointSaver, Checkpoint } from '@langchain/langgraph-checkpoint';
import { DateTime } from 'luxon';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

jest.mock('@langchain/core/messages', () => ({
  SystemMessage: jest.fn().mockImplementation((content: string) => ({
    content,
    type: 'system',
    additional_kwargs: {},
  })),
  HumanMessage: jest.fn().mockImplementation((content: string) => ({
    content,
    type: 'human',
    additional_kwargs: {},
  })),
  AIMessage: jest.fn().mockImplementation((content: string) => ({
    content,
    type: 'ai',
    additional_kwargs: {},
  })),
}));

import { SubscriberService } from '../features/subscriber/subscriber.service';
import { DigestService } from '../features/digest/digest.service';
import { Digest } from '../features/digest/digest.types';

jest.mock('@langchain/openai');
jest.mock('../features/subscriber/subscriber.prompts');
import { generateSystemPrompt } from '../features/subscriber/subscriber.prompts';
let mockGenerateSystemPrompt = generateSystemPrompt as jest.Mock;

const mockHydrateSubscriber = jest.fn();
const mockSubscriberServiceInstance = {
  hydrateSubscriber: mockHydrateSubscriber,
  getDailySystemPrompt: jest.fn(() => mockGenerateSystemPrompt()),
  getMissingProfileFieldsReflective: jest.fn(),
  updateSubscriber: jest.fn(),
};

jest.mock('../features/subscriber/subscriber.service', () => ({
  SubscriberService: {
    getInstance: jest.fn(() => mockSubscriberServiceInstance),
  },
}));

const mockGetConversationDigest = jest.fn();
const mockGetRecentDigests = jest.fn();
const mockDigestServiceInstance = {
  getConversationDigest: mockGetConversationDigest,
  getRecentDigests: mockGetRecentDigests,
};

jest.mock('../features/digest/digest.service', () => ({
  DigestService: {
    getInstance: jest.fn(() => mockDigestServiceInstance),
  },
}));

import { FeedbackService } from '../features/feedback/feedback.service';
jest.mock('../features/feedback/feedback.service');

class MockCheckpointer implements BaseCheckpointSaver {
  getTuple: jest.Mock = jest.fn();
  putTuple: jest.Fn = jest.fn();
  put: jest.Mock = jest.fn();
  deleteThread: jest.Mock = jest.fn();
  list: jest.Mock = jest.fn();
  get: jest.Mock = jest.fn(); 
}

let mockMainAgentInvoke: jest.Mock = jest.fn();
let mockFeedbackSubgraphInvoke: jest.Mock = jest.fn();
let mockOnboardingSubgraphInvoke: jest.Fn = jest.fn();
let mockStateGraphCompile: jest.Mock = jest.fn();

describe('LanguageBuddyAgent', () => {

  let mockCheckpointer: jest.Mocked<MockCheckpointer>;
  let mockLlm: jest.Mocked<ChatOpenAI>;
  let agent: LanguageBuddyAgent;
  let mockDigestService: jest.Mocked<DigestService>;

  const mockSubscriber: Subscriber = {
    profile: {
      name: "Test User",
      speakingLanguages: [
        {
          languageName: "English",
          overallLevel: "C2",
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
          languageName: "German",
          overallLevel: "B1",
          skillAssessments: [],
          deficiencies: [],
          firstEncountered: new Date(),
          lastPracticed: new Date(),
          totalPracticeTime: 0,
          confidenceScore: 50,
          isTarget: true,
        },
      ],
      timezone: "America/New_York",
      fluencyLevel: "intermediate",
      areasOfStruggle: ["grammar", "vocabulary"],
      mistakeTolerance: "normal"
    },
    connections: {
      phone: "+1234567890",
    },
    metadata: {
      digests: [],
      personality: "friendly",
      streakData: {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: new Date(),
      },
      predictedChurnRisk: 0,
      engagementScore: 50,
      difficultyPreference: "adaptive",
    },
    isPremium: false,
    signedUpAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Re-acquire the mock for generateSystemPrompt after resetModules
    const promptsModule = require('../features/subscriber/subscriber.prompts');
    mockGenerateSystemPrompt = promptsModule.generateSystemPrompt;

    mockMainAgentInvoke.mockReset();
    mockFeedbackSubgraphInvoke.mockReset();
    mockOnboardingSubgraphInvoke.mockReset();
    mockStateGraphCompile.mockReset();

    jest.doMock("@langchain/langgraph", () => ({
      StateGraph: jest.fn(() => ({
        addNode: jest.fn(function() { return this; }),
        addConditionalEdges: jest.fn(function() { return this; }),
        addEdge: jest.fn(function() { return this; }),
        compile: mockStateGraphCompile,
      })),
      START: jest.fn(),
      END: jest.fn(),
      addMessages: jest.fn(),
    }));

    jest.doMock("@langchain/langgraph/prebuilt", () => ({
      createReactAgent: jest.fn(() => ({ invoke: mockMainAgentInvoke, getGraph: jest.fn() })),
    }));
    jest.doMock("../features/feedback/feedback.graph", () => ({
      createFeedbackGraph: jest.fn(() => ({ invoke: mockFeedbackSubgraphInvoke, getGraph: jest.fn() })),
    }));
    jest.doMock("../features/onboarding/onboarding.graph", () => ({
      createOnboardingGraph: jest.fn(() => ({ invoke: mockOnboardingSubgraphInvoke, getGraph: jest.fn() })),
    }));

    const { LanguageBuddyAgent } = require('./language-buddy-agent');

    mockCheckpointer = new MockCheckpointer() as jest.Mocked<MockCheckpointer>;
    mockLlm = { invoke: jest.fn() } as unknown as jest.Mocked<ChatOpenAI>;
    const mockFeedbackService = {} as jest.Mocked<FeedbackService>;
    mockGetRecentDigests.mockResolvedValue([]);

    (SubscriberService.getInstance as jest.Mock).mockReturnValue(mockSubscriberServiceInstance);

    const mockAgentInvoke = jest.fn();
    mockStateGraphCompile.mockReturnValue({ invoke: mockAgentInvoke });

    agent = new LanguageBuddyAgent(mockCheckpointer, mockLlm, mockDigestServiceInstance as any, mockFeedbackService);

    jest.useFakeTimers();
    mockGenerateSystemPrompt.mockReturnValue('Generated System Prompt');
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('getConversationDuration', () => {
    it('should return null if no checkpoint is found', async () => {
      mockCheckpointer.getTuple.mockResolvedValueOnce(undefined);
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });

    it('should return null if conversationStartedAt is not in metadata', async () => {
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: new Date().toISOString(), channel_values: {}, versions_seen: {},
        values: {}, pending_sends: []
      };
      mockCheckpointer.getTuple.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });

    it('should calculate the correct conversation duration in minutes', async () => {
      const startedAt = DateTime.now().minus({ minutes: 30, seconds: 15 }).toISO();
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: new Date().toISOString(), channel_values: {}, versions_seen: {},
        values: {}, pending_sends: []
      };
      mockCheckpointer.getTuple.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: { conversationStartedAt: startedAt }, parentConfig: {}
      });
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeCloseTo(30.25, 1);
    });

    it('should handle errors gracefully', async () => {
      mockCheckpointer.getTuple.mockRejectedValueOnce(new Error('Checkpoint error'));
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });
  });

  describe('getTimeSinceLastMessage', () => {
    it('should return null if no checkpoint is found', async () => {
      mockCheckpointer.getTuple.mockResolvedValueOnce(undefined);
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });

    it('should return null if no messages in checkpoint', async () => {
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: new Date().toISOString(), channel_values: {}, versions_seen: {},
        values: { messages: [] }, pending_sends: []
      };
      mockCheckpointer.getTuple.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });

    it('should return null if last message has no timestamp', async () => {
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: new Date().toISOString(), channel_values: {}, versions_seen: {},
        values: { messages: [{ content: 'hi' }] }, pending_sends: []
      };
      mockCheckpointer.getTuple.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });

    it('should calculate the correct time since last message in minutes', async () => {
      const lastMessageTime = DateTime.now().minus({ hours: 1, minutes: 15 }).toISO();
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: new Date().toISOString(), channel_values: {}, versions_seen: {},
        values: { messages: [{ content: 'last', timestamp: lastMessageTime }] }, pending_sends: []
      };
      mockCheckpointer.getTuple.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });

      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeCloseTo(75, 1);
    });

    it('should handle errors gracefully', async () => {
      mockCheckpointer.getTuple.mockRejectedValueOnce(new Error('Checkpoint error'));
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });
  });

  describe('initiateConversation', () => {
    it('should generate system prompt and invoke agent with it', async () => {
      const humanMessage = 'Hi there!';
      jest.spyOn(agent, 'getConversationDuration').mockResolvedValue(60);
      jest.spyOn(agent, 'getTimeSinceLastMessage').mockResolvedValue(10);
      
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber,
      });

      const result = await agent.initiateConversation(mockSubscriber, humanMessage);

      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          conversationDurationMinutes: 60,
          timeSinceLastMessageMinutes: 10,
          currentLocalTime: expect.anything(),
          lastDigestTopic: null,
        })
      );
      
      const currentLocalTime = DateTime.now().setZone(mockSubscriber.profile.timezone || 'UTC');
      const dateString = currentLocalTime.toISODate();
      const expectedSessionId = `${mockSubscriber.connections.phone}_${dateString}`;

      expect(agent.agent.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ content: 'Generated System Prompt', type: 'system' }),
            expect.objectContaining({ content: humanMessage, type: 'human' })
          ],
        }),
        {
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: expect.objectContaining({ sessionId: expectedSessionId })
        }
      );
      expect(result.response).toEqual('AI Response');
    });

    it('should pass the last digest topic to generateSystemPrompt if available', async () => {
      const humanMessage = 'Hi there!';
      const mockDigest: Digest = {
        timestamp: new Date().toISOString(),
        topic: 'Conditional Sentences',
        summary: 'Discussed conditional sentences and hypothetical situations.',
        keyBreakthroughs: [],
        areasOfStruggle: [],
        vocabulary: { newWords: [], reviewedWords: [], struggledWith: [], mastered: [] },
        phrases: { newPhrases: [], idioms: [] },
        grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
        conversationMetrics: {
          messagesExchanged: 10, averageResponseTime: 0, topicsDiscussed: [], userInitiatedTopics: 0,
          averageMessageLength: 0, sentenceComplexity: 0, punctuationAccuracy: 0, capitalizationAccuracy: 0,
          textCoherenceScore: 0, emojiUsage: 0, abbreviationUsage: []
        },
        userMemos: []
      };
      
      mockGetRecentDigests.mockResolvedValueOnce([mockDigest]);
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber,
      });

      const result = await agent.initiateConversation(mockSubscriber, humanMessage);

      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          lastDigestTopic: mockDigest.topic,
        })
      );
      expect(result.response).toEqual('AI Response');
    });

    it('should return AI response', async () => {
      const humanMessage = 'Hello!';
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber,
      });
      const response = await agent.initiateConversation(mockSubscriber, humanMessage);
      expect(response.response).toEqual('AI Response');
    });

    it('should use systemPromptOverride if provided', async () => {
      const humanMessage = 'Hello!';
      const overridePrompt = 'Override Prompt';
      
      mockGenerateSystemPrompt.mockClear(); 
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage(overridePrompt),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response from override')
        ],
        subscriber: mockSubscriber,
      });
      
      const response = await agent.initiateConversation(mockSubscriber, humanMessage, overridePrompt);

      expect(mockGenerateSystemPrompt).not.toHaveBeenCalled();
      expect(agent.agent.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ content: overridePrompt, type: 'system' }),
            expect.objectContaining({ content: humanMessage, type: 'human' })
          ],
        }),
        expect.anything()
      );
      expect(response.response).toEqual('AI Response from override');
    });

    it('should handle errors gracefully', async () => {
      agent.agent.invoke.mockRejectedValueOnce(new Error('Agent error'));
      const humanMessage = 'Test error';
      const response = await agent.initiateConversation(mockSubscriber, humanMessage);
      expect(response.response).toContain('An error occurred while initiating the conversation.');
    });
  });

  describe('processUserMessage', () => {
    it('should generate system prompt and invoke agent with it', async () => {
      const humanMessage = 'What\'s up?';
      jest.spyOn(agent, 'getConversationDuration').mockResolvedValue(60);
      jest.spyOn(agent, 'getTimeSinceLastMessage').mockResolvedValue(10);
      
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber,
      });

      const result = await agent.processUserMessage(mockSubscriber, humanMessage);

      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          conversationDurationMinutes: 60,
          timeSinceLastMessageMinutes: 10,
          currentLocalTime: expect.anything(),
          lastDigestTopic: null,
        })
      );
      
      const currentLocalTime = DateTime.now().setZone(mockSubscriber.profile.timezone || 'UTC');
      const dateString = currentLocalTime.toISODate();
      const expectedSessionId = `${mockSubscriber.connections.phone}_${dateString}`;

      expect(agent.agent.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ content: 'Generated System Prompt', type: 'system' }),
            expect.objectContaining({ content: humanMessage, type: 'human' })
          ],
        }),
        {
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: expect.objectContaining({ sessionId: expectedSessionId })
        }
      );
      expect(result.response).toEqual('AI Response');
    });

    it('should return AI response', async () => {
      const humanMessage = 'Yo!';
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber,
      });
      const response = await agent.processUserMessage(mockSubscriber, humanMessage);
      expect(response.response).toEqual('AI Response');
    });

    it('should handle errors gracefully', async () => {
      agent.agent.invoke.mockRejectedValueOnce(new Error('Agent error'));
      const humanMessage = 'Test error';
      const response = await agent.processUserMessage(mockSubscriber, humanMessage);
      expect(response.response).toContain('An error occurred while processing your message.');
    });
  });

  describe('oneShotMessage', () => {
    it('should invoke llm directly and return the response content', async () => {
      const systemPrompt = 'Test Question';
      const language = 'English';
      const phone = '123456';
      
      mockLlm.invoke.mockResolvedValueOnce({ content: 'Translated Question' } as any);

      const response = await agent.oneShotMessage(systemPrompt, language, phone);

      expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
      
      const invokeArg = (mockLlm.invoke.mock.calls[0][0] as any)[0];
      expect(invokeArg.content).toContain('Test Question');
      expect(invokeArg.content).toContain('English');
      
      expect(response).toBe('Translated Question');
    });

    it('should handle non-string content from llm', async () => {
      const systemPrompt = 'Test Question';
      mockLlm.invoke.mockResolvedValueOnce({ content: ['Block 1', 'Block 2'] } as any);

      const response = await agent.oneShotMessage(systemPrompt, 'English', '123');
      
      expect(response).toBe('["Block 1","Block 2"]');
    });

    it('should handle errors gracefully', async () => {
      mockLlm.invoke.mockRejectedValueOnce(new Error('LLM Error'));
      
      const response = await agent.oneShotMessage('Test', 'English', '123');
      
      expect(response).toBe('An error occurred while generating the message.');
    });
  });
});