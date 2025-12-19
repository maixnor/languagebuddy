import { ChatOpenAI } from '@langchain/openai';
import { Checkpoint } from '@langchain/langgraph';
import { DateTime } from 'luxon';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages"; // Keep original import for types

jest.mock('@langchain/core/messages', () => ({
  SystemMessage: jest.fn().mockImplementation((content: string) => ({
    content,
    type: 'system',
    // Add other properties that LangGraph might expect, if any, for proper functioning
    // For now, let's keep it minimal to see if it fixes the additional_kwargs error
    additional_kwargs: {}, // Explicitly define it to prevent the TypeError
  })),
  HumanMessage: jest.fn().mockImplementation((content: string) => ({
    content,
    type: 'human',
    additional_kwargs: {}, // Explicitly define it to prevent the TypeError
  })),
  AIMessage: jest.fn().mockImplementation((content: string) => ({
    content,
    type: 'ai',
    additional_kwargs: {}, // Explicitly define it to prevent the TypeError
  })),
}));
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { DigestService } from '../features/digest/digest.service';
import { Digest } from '../features/digest/digest.types';


jest.mock('@langchain/openai');
jest.mock('../features/subscriber/subscriber.prompts'); // Mock generateSystemPrompt
import { generateSystemPrompt } from '../features/subscriber/subscriber.prompts'; // For type referencing
const mockGenerateSystemPrompt = generateSystemPrompt as jest.Mock;

// Mock SubscriberService and its static getInstance method
const mockHydrateSubscriber = jest.fn();
const mockSubscriberServiceInstance = {
  hydrateSubscriber: mockHydrateSubscriber,
  // Add any other methods that LanguageBuddyAgent might call directly on the SubscriberService instance
        getDailySystemPrompt: jest.fn(() => mockGenerateSystemPrompt()),  getMissingProfileFieldsReflective: jest.fn(),
  updateSubscriber: jest.fn(),
};

// Make sure the mock for the SubscriberService class itself is correctly implemented
jest.mock('../features/subscriber/subscriber.service', () => ({
  SubscriberService: {
    getInstance: jest.fn(() => mockSubscriberServiceInstance),
    // Add other static methods if they exist and are called in the agent
  },
}));
import { SubscriberService } from '../features/subscriber/subscriber.service'; // Keep import for types

// Mock DigestService
const mockGetConversationDigest = jest.fn();
const mockGetRecentDigests = jest.fn();
const mockDigestServiceInstance = {
  getConversationDigest: mockGetConversationDigest,
  getRecentDigests: mockGetRecentDigests, // Added this line
  // Add any other methods DigestService might have
};

jest.mock('../features/digest/digest.service', () => ({
  DigestService: {
    getInstance: jest.fn(() => mockDigestServiceInstance),
  },
}));

import { FeedbackService } from '../features/feedback/feedback.service';
jest.mock('../features/feedback/feedback.service'); // Mock FeedbackService

// Define a mock class that implements BaseCheckpointSaver
class MockCheckpointer implements BaseCheckpointSaver {
  getTuple: jest.Mock = jest.fn();
  putTuple: jest.Fn = jest.fn();
  put: jest.Mock = jest.fn();
  deleteThread: jest.Mock = jest.fn();
  list: jest.Mock = jest.fn();
  get: jest.Mock = jest.fn(); // Assuming 'get' might be used directly for some reason, though getTuple is preferred
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
    // IMPORTANT: Clear the module cache and re-require LanguageBuddyAgent
    // after setting up doMock to ensure it gets the mocked dependencies.
    jest.clearAllMocks(); // Clear mocks before each test to ensure isolation
    jest.resetModules(); // Use resetModules instead of clearModules

    mockMainAgentInvoke.mockReset(); // Reset the global mock
    mockFeedbackSubgraphInvoke.mockReset();
    mockOnboardingSubgraphInvoke.mockReset();

    // Initialize mock runnables
    mockStateGraphCompile.mockReset(); // Reset before each test

    jest.doMock("@langchain/langgraph", () => ({
      StateGraph: jest.fn(() => ({
        addNode: jest.fn(function() { return this; }), // chainable
        addConditionalEdges: jest.fn(function() { return this; }), // chainable
        addEdge: jest.fn(function() { return this; }), // chainable
        compile: mockStateGraphCompile,
      })),
      START: jest.fn(),
      END: jest.fn(),
      addMessages: jest.fn(),
    }));

    // Mock the subgraph creation functions to return simple objects that don't need to be actual Runnables
    jest.doMock("@langchain/langgraph/prebuilt", () => ({
      createReactAgent: jest.fn(() => ({ invoke: mockMainAgentInvoke, getGraph: jest.fn() })),
    }));
    jest.doMock("../features/feedback/feedback.graph", () => ({
      createFeedbackGraph: jest.fn(() => ({ invoke: mockFeedbackSubgraphInvoke, getGraph: jest.fn() })),
    }));
    jest.doMock("../features/onboarding/onboarding.graph", () => ({
      createOnboardingGraph: jest.fn(() => ({ invoke: mockOnboardingSubgraphInvoke, getGraph: jest.fn() })),
    }));

    // Re-import LanguageBuddyAgent after mocks are defined
    const { LanguageBuddyAgent } = require('./language-buddy-agent');

    mockCheckpointer = new MockCheckpointer() as jest.Mocked<MockCheckpointer>;
    mockLlm = { invoke: jest.fn() } as unknown as jest.Mocked<ChatOpenAI>;
    const mockFeedbackService = {} as jest.Mocked<FeedbackService>;
    mockGetRecentDigests.mockResolvedValue([]); // Default to no digests

    // Mock SubscriberService.getInstance to return the desired mock object
    (SubscriberService.getInstance as jest.Mock).mockReturnValue(mockSubscriberServiceInstance);

    // Define mockAgentInvoke for direct use in tests
    const mockAgentInvoke = jest.fn();
    mockStateGraphCompile.mockReturnValue({ invoke: mockAgentInvoke }); // Ensure workflow.compile returns an object with this invoke

    agent = new LanguageBuddyAgent(mockCheckpointer, mockLlm, mockDigestServiceInstance as any, mockFeedbackService);

    jest.useFakeTimers();
    mockGenerateSystemPrompt.mockReturnValue('Generated System Prompt');
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers(); // Restore real timers
  });

  describe('Feedback Routing', () => {
    beforeEach(() => {
      // Reset mocks before each test in this describe block
      mockMainAgentInvoke.mockReset();
      mockFeedbackSubgraphInvoke.mockReset();
      mockCheckpointer.getTuple.mockReset();

      // Default mock for checkpoint for most tests
      mockCheckpointer.getTuple.mockResolvedValue({
        config: {},
        checkpoint: {
          v: 1, id: '1', ts: DateTime.now().toISO(), channel_values: {}, versions_seen: {},
          values: { messages: [] }, pending_sends: []
        },
        metadata: {},
        parentConfig: {}
      });
    });

    it('should transition to feedback subgraph when LLM calls startFeedbackSession tool', async () => {
      // 1. Mock mainAgentSubgraph to return an AIMessage that calls startFeedbackSession
      mockMainAgentInvoke.mockResolvedValueOnce({
        messages: [
          new HumanMessage("I want to give feedback"),
          new AIMessage({
            content: "Okay, I'll start the feedback session.",
            tool_calls: [{
              name: "startFeedbackSession",
              args: {},
              id: "call_feedback_1"
            }]
          })
        ]
      });

      // 2. Mock feedbackSubgraph to return a typical response
      mockFeedbackSubgraphInvoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage("Initial system message"),
          new HumanMessage("I want to give feedback"),
          new AIMessage("Thanks for wanting to give feedback! What is your feedback?")
        ],
        activeMode: "feedback", // Stays in feedback mode initially
        subgraphState: {
          messages: [new HumanMessage("I want to give feedback")]
        }
      });

      const humanMessage = 'I want to give feedback';
      const result = await agent.processUserMessage(mockSubscriber, humanMessage);

      // Verify that mainAgentSubgraph was invoked first
      expect(mockMainAgentInvoke).toHaveBeenCalledTimes(1);
      
      // Verify that the feedback subgraph was invoked
      expect(mockFeedbackSubgraphInvoke).toHaveBeenCalledTimes(1);
      
      // Verify the final output from the agent
      expect(result.response).toContain("Thanks for wanting to give feedback! What is your feedback?");
    });

    it('should not transition to feedback subgraph if tool is not called', async () => {
      // Mock mainAgentSubgraph to return a normal AI message without a tool call
      mockMainAgentInvoke.mockResolvedValueOnce({
        messages: [
          new HumanMessage("How are you?"),
          new AIMessage("I'm doing great, how about you?")
        ]
      });

      const humanMessage = 'How are you?';
      const result = await agent.processUserMessage(mockSubscriber, humanMessage);

      // Verify that mainAgentSubgraph was invoked
      expect(mockMainAgentInvoke).toHaveBeenCalledTimes(1);
      
      // Verify that the feedback subgraph was NOT invoked
      expect(mockFeedbackSubgraphInvoke).not.toHaveBeenCalled();
      
      // Verify the final output from the agent is from the main agent
      expect(result.response).toContain("I'm doing great, how about you?");
    });
  });


  describe('getConversationDuration', () => {
    it('should return null if no checkpoint is found', async () => {
      mockCheckpointer.get.mockResolvedValueOnce(undefined);
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });

    it('should return null if conversationStartedAt is not in metadata', async () => {
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: new Date().toISOString(), channel_values: {}, versions_seen: {},
        values: {}, pending_sends: []
      };
      mockCheckpointer.get.mockResolvedValueOnce({
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
      expect(duration).toBeCloseTo(30.25, 1); // Roughly 30 minutes and 15 seconds
    });


    it('should handle errors gracefully', async () => {
      mockCheckpointer.get.mockRejectedValueOnce(new Error('Checkpoint error'));
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });
  });

  describe('getTimeSinceLastMessage', () => {
    it('should return null if no checkpoint is found', async () => {
      mockCheckpointer.get.mockResolvedValueOnce(undefined);
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
      expect(timeSince).toBeCloseTo(75, 1); // 1 hour and 15 minutes
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
      // Mock for conversationDurationMinutes and timeSinceLastMessageMinutes
      jest.spyOn(agent, 'getConversationDuration').mockResolvedValue(60);
      jest.spyOn(agent, 'getTimeSinceLastMessage').mockResolvedValue(10);
      
      // Mock the agent.agent.invoke for this specific test
      mockAgentInvoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber, // Add the subscriber property
      });

      const result = await agent.initiateConversation(mockSubscriber, humanMessage);

      // The conversationDurationMinutes and timeSinceLastMessageMinutes are derived from agent's own methods,
      // which internally call mockCheckpointer.getTuple. We verify the final values passed to generateSystemPrompt.
      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          conversationDurationMinutes: 60,
          timeSinceLastMessageMinutes: 10,
          currentLocalTime: expect.any(DateTime),
          lastDigestTopic: null,
        })
      );
      // Dynamically calculate sessionId to match agent's logic
      const currentLocalTime = DateTime.now().setZone(mockSubscriber.profile.timezone || 'UTC');
      const dateString = currentLocalTime.toISODate();
      const expectedSessionId = `${mockSubscriber.connections.phone}_${dateString}`;

      expect(mockAgentInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ content: 'Generated System Prompt', type: 'system', additional_kwargs: {} }),
            expect.objectContaining({ content: humanMessage, type: 'human', additional_kwargs: {} })
          ],
        }),
        { 
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: { sessionId: expectedSessionId }
        }
      );
      expect(result.response).toEqual('AI Response'); // Add assertion for response
      expect(result.updatedSubscriber).toBeDefined(); // Add assertion for updatedSubscriber
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
      // Mock the agent's invoke for this test to return a specific state
      mockAgentInvoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber, // Add the subscriber property
      });

      const result = await agent.initiateConversation(mockSubscriber, humanMessage);

      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          lastDigestTopic: mockDigest.topic,
        })
      );
      expect(result.response).toEqual('AI Response'); // Add assertion for response
      expect(result.updatedSubscriber).toBeDefined(); // Add assertion for updatedSubscriber

    });

    it('should return AI response', async () => {
      const humanMessage = 'Hello!';
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber, // Add the subscriber property
      });
      const response = await agent.initiateConversation(mockSubscriber, humanMessage);
      expect(response.response).toEqual('AI Response');
      expect(response.updatedSubscriber).toBeDefined();
    });

    it('should use systemPromptOverride if provided', async () => {
      const humanMessage = 'Hello!';
      const overridePrompt = 'Override Prompt';
      
      mockGenerateSystemPrompt.mockClear(); // Reset mock call count
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage(overridePrompt),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response from override')
        ],
        subscriber: mockSubscriber, // Add the subscriber property
      });
      
      const response = await agent.initiateConversation(mockSubscriber, humanMessage, overridePrompt);

      const expectedSessionId = `${mockSubscriber.connections.phone}_${DateTime.now().setZone(mockSubscriber.profile.timezone || 'UTC').toISODate()}`;

      expect(mockGenerateSystemPrompt).not.toHaveBeenCalled();
      expect(agent.agent.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ content: overridePrompt, type: 'system', additional_kwargs: {} }),
            expect.objectContaining({ content: humanMessage, type: 'human', additional_kwargs: {} })
          ],
        }),
        { 
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: { sessionId: expectedSessionId }
        }
      );
      expect(response.response).toEqual('AI Response from override'); // Changed to match mock
      expect(response.updatedSubscriber).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      agent.agent.invoke.mockRejectedValueOnce(new Error('Agent error'));
      const humanMessage = 'Test error';
      const response = await agent.initiateConversation(mockSubscriber, humanMessage);
      expect(response.response).toContain('An error occurred while initiating the conversation.');
      expect(response.updatedSubscriber).toEqual(mockSubscriber);
    });
  });

  describe('processUserMessage', () => {
    it('should generate system prompt and invoke agent with it', async () => {
      const humanMessage = 'What\'s up?';
      // Mock for conversationDurationMinutes and timeSinceLastMessageMinutes
      jest.spyOn(agent, 'getConversationDuration').mockResolvedValue(60);
      jest.spyOn(agent, 'getTimeSinceLastMessage').mockResolvedValue(10);
      
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber, // Add the subscriber property
      });

      const result = await agent.processUserMessage(mockSubscriber, humanMessage);

      // The conversationDurationMinutes and timeSinceLastMessageMinutes are derived from agent's own methods,
      // which internally call mockCheckpointer.getTuple. We verify the final values passed to generateSystemPrompt.
      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          conversationDurationMinutes: 60,
          timeSinceLastMessageMinutes: 10,
          currentLocalTime: expect.any(DateTime),
          lastDigestTopic: null,
        })
      );
      // Dynamically calculate sessionId to match agent's logic
      const currentLocalTime = DateTime.now().setZone(mockSubscriber.profile.timezone || 'UTC');
      const dateString = currentLocalTime.toISODate();
      const expectedSessionId = `${mockSubscriber.connections.phone}_${dateString}`;

      expect(agent.agent.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ content: 'Generated System Prompt', type: 'system', additional_kwargs: {} }),
            expect.objectContaining({ content: humanMessage, type: 'human', additional_kwargs: {} })
          ],
        }),
        { 
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: { sessionId: expectedSessionId }
        }
      );
      expect(result.response).toEqual('AI Response'); // Add assertion for response
      expect(result.updatedSubscriber).toBeDefined(); // Add assertion for updatedSubscriber

    });

    it('should return AI response', async () => {
      const humanMessage = 'Yo!';
      agent.agent.invoke.mockResolvedValueOnce({
        messages: [
          new SystemMessage('Generated System Prompt'),
          new HumanMessage(humanMessage),
          new AIMessage('AI Response')
        ],
        subscriber: mockSubscriber, // Add the subscriber property
      });
      const response = await agent.processUserMessage(mockSubscriber, humanMessage);
      expect(response.response).toEqual('AI Response');
      expect(response.updatedSubscriber).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      agent.agent.invoke.mockRejectedValueOnce(new Error('Agent error'));
      const humanMessage = 'Test error';
      const response = await agent.processUserMessage(mockSubscriber, humanMessage);
      expect(response.response).toContain('An error occurred while processing your message.');
      expect(response.updatedSubscriber).toEqual(mockSubscriber);
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
      expect(mockLlm.invoke).toHaveBeenCalledWith([expect.objectContaining({ content: expect.any(String) })]);
      
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
