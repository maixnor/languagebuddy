import { LanguageBuddyAgent } from './language-buddy-agent';

import { ChatOpenAI } from '@langchain/openai';
import { Checkpoint } from '@langchain/langgraph';
import { DateTime } from 'luxon';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { DigestService } from '../features/digest/digest.service';
import { Digest } from '../features/digest/digest.types';


jest.mock('@langchain/openai');
jest.mock('../features/subscriber/subscriber.prompts'); // Mock generateSystemPrompt
import { generateSystemPrompt } from '../features/subscriber/subscriber.prompts'; // For type referencing
const mockGenerateSystemPrompt = generateSystemPrompt as jest.Mock;
jest.mock('../features/subscriber/subscriber.service'); // Mock SubscriberService
jest.mock('../features/digest/digest.service'); // Mock DigestService

import { FeedbackService } from '../features/feedback/feedback.service';
jest.mock('../features/feedback/feedback.service'); // Mock FeedbackService

// Define a mock class that implements BaseCheckpointSaver

class MockCheckpointer implements BaseCheckpointSaver {

  getTuple: jest.Mock = jest.fn();

  putTuple: jest.Mock = jest.fn();

  put: jest.Mock = jest.fn();

  deleteThread: jest.Mock = jest.fn();

  list: jest.Mock = jest.fn();

  get: jest.Mock = jest.fn(); // Assuming 'get' might be used directly for some reason, though getTuple is preferred

}



describe('LanguageBuddyAgent', () => {

  let mockCheckpointer: jest.Mocked<MockCheckpointer>;

  let mockLlm: jest.Mocked<ChatOpenAI>;

  let agent: LanguageBuddyAgent;

  let mockAgentInvoke: jest.Mock;

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

    mockCheckpointer = new MockCheckpointer() as jest.Mocked<MockCheckpointer>;

    mockLlm = { invoke: jest.fn() } as unknown as jest.Mocked<ChatOpenAI>;

    mockAgentInvoke = jest.fn().mockResolvedValue({

      messages: [{ content: 'AI Response' }]

    });



    (SubscriberService.getInstance as jest.Mock).mockReturnValue({

      hydrateSubscriber: jest.fn(),

    });

        mockDigestService = new DigestService(null as any, mockCheckpointer, null as any) as jest.Mocked<DigestService>;

        mockDigestService.getRecentDigests.mockResolvedValue([]); // Default to no digests

        const mockFeedbackService = {} as jest.Mocked<FeedbackService>;

    

    

        agent = new LanguageBuddyAgent(mockCheckpointer, mockLlm, mockDigestService, mockFeedbackService);

        (agent as any).agent = { invoke: mockAgentInvoke }; 



    jest.useFakeTimers(); 

    mockGenerateSystemPrompt.mockReturnValue('Generated System Prompt');

  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers(); // Restore real timers
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
      const now = DateTime.now();
      const conversationStartedAt = now.minus({ minutes: 60 }).toISO();
      const lastMessageTime = now.minus({ minutes: 10 }).toISO();
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: now.toISO(), channel_values: {
          messages: [{ content: 'test', timestamp: lastMessageTime }]
        }, versions_seen: {},
        values: {}, pending_sends: []
      };


      await agent.initiateConversation(mockSubscriber, humanMessage);

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
        expect.objectContaining({ messages: [expect.any(SystemMessage), expect.any(HumanMessage)] }),
        { 
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: { sessionId: expectedSessionId }
        }
      );
      const invokeArgs = mockAgentInvoke.mock.calls[0][0].messages;
      expect(invokeArgs[0]).toBeInstanceOf(SystemMessage);
      expect(invokeArgs[0].content).toEqual('Generated System Prompt');
      expect(invokeArgs[1]).toBeInstanceOf(HumanMessage);
      expect(invokeArgs[1].content).toEqual(humanMessage);
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
      
      mockDigestService.getRecentDigests.mockResolvedValueOnce([mockDigest]);
      const now = DateTime.now();
      const conversationStartedAt = now.minus({ minutes: 60 }).toISO();
      const lastMessageTime = now.minus({ minutes: 10 }).toISO();
      const checkpoint: Checkpoint = {
          v: 1, id: '1', ts: now.toISO(), channel_values: {
              messages: [{ content: 'test', timestamp: lastMessageTime }]
          }, versions_seen: {},
          values: {}, pending_sends: []
      };
      mockCheckpointer.get.mockResolvedValueOnce({
          config: {}, checkpoint, metadata: { conversationStartedAt }, parentConfig: {}
      });

      await agent.initiateConversation(mockSubscriber, humanMessage);

      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          lastDigestTopic: mockDigest.topic,
        })
      );
    });

    it('should return AI response', async () => {
      const humanMessage = 'Hello!';
      const response = await agent.initiateConversation(mockSubscriber, humanMessage);
      expect(response).toEqual('AI Response');
    });

    it('should use systemPromptOverride if provided', async () => {
      const humanMessage = 'Hello!';
      const overridePrompt = 'Override Prompt';
      
      mockGenerateSystemPrompt.mockClear(); // Reset mock call count
      
      await agent.initiateConversation(mockSubscriber, humanMessage, overridePrompt);

      const expectedSessionId = `${mockSubscriber.connections.phone}_${DateTime.now().setZone(mockSubscriber.profile.timezone || 'UTC').toISODate()}`;

      expect(mockGenerateSystemPrompt).not.toHaveBeenCalled();
      expect(mockAgentInvoke).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [expect.any(SystemMessage), expect.any(HumanMessage)] }),
        { 
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: { sessionId: expectedSessionId }
        }
      );
      const invokeArgs = mockAgentInvoke.mock.calls[0][0].messages;
      expect(invokeArgs[0]).toBeInstanceOf(SystemMessage);
      expect(invokeArgs[0].content).toEqual(overridePrompt);
    });

    it('should handle errors gracefully', async () => {
      mockAgentInvoke.mockRejectedValueOnce(new Error('Agent error'));
      const humanMessage = 'Test error';
      const response = await agent.initiateConversation(mockSubscriber, humanMessage);
      expect(response).toContain('An error occurred while initiating the conversation.');
    });
  });

  describe('processUserMessage', () => {
    it('should generate system prompt and invoke agent with it', async () => {
      const humanMessage = 'What\'s up?';
      // Mock for conversationDurationMinutes and timeSinceLastMessageMinutes
      jest.spyOn(agent, 'getConversationDuration').mockResolvedValue(60);
      jest.spyOn(agent, 'getTimeSinceLastMessage').mockResolvedValue(10);
      const now = DateTime.now();
      const conversationStartedAt = now.minus({ minutes: 60 }).toISO();
      const lastMessageTime = now.minus({ minutes: 10 }).toISO();
      const checkpoint: Checkpoint = {
        v: 1, id: '1', ts: now.toISO(), channel_values: {
          messages: [{ content: 'test', timestamp: lastMessageTime }]
        }, versions_seen: {},
        values: {}, pending_sends: []
      };


      await agent.processUserMessage(mockSubscriber, humanMessage);

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
        expect.objectContaining({ messages: [expect.any(SystemMessage), expect.any(HumanMessage)] }),
        { 
          configurable: { thread_id: mockSubscriber.connections.phone },
          metadata: { sessionId: expectedSessionId }
        }
      );
      const invokeArgs = mockAgentInvoke.mock.calls[0][0].messages;
      expect(invokeArgs[0]).toBeInstanceOf(SystemMessage);
      expect(invokeArgs[0].content).toEqual('Generated System Prompt');
      expect(invokeArgs[1]).toBeInstanceOf(HumanMessage);
      expect(invokeArgs[1].content).toEqual(humanMessage);
    });

    it('should return AI response', async () => {
      const humanMessage = 'Yo!';
      const response = await agent.processUserMessage(mockSubscriber, humanMessage);
      expect(response).toEqual('AI Response');
    });

    it('should handle errors gracefully', async () => {
      mockAgentInvoke.mockRejectedValueOnce(new Error('Agent error'));
      const humanMessage = 'Test error';
      // processUserMessage currently throws on error, so we expect it to throw
      await expect(agent.processUserMessage(mockSubscriber, humanMessage)).rejects.toThrow('Agent error');
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
      expect(mockLlm.invoke).toHaveBeenCalledWith([expect.any(SystemMessage)]);
      
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
