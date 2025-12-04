import { LanguageBuddyAgent } from './language-buddy-agent';
import { RedisCheckpointSaver } from '../persistence/redis-checkpointer';
import { ChatOpenAI } from '@langchain/openai';
import { Checkpoint } from '@langchain/langgraph';
import { DateTime } from 'luxon';
import { generateSystemPrompt } from '../util/system-prompts';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { HumanMessage, SystemMessage } from "@langchain/core/messages";


jest.mock('../persistence/redis-checkpointer');
jest.mock('@langchain/openai');
jest.mock('../util/system-prompts'); // Mock generateSystemPrompt

const mockGenerateSystemPrompt = generateSystemPrompt as jest.Mock;

describe('LanguageBuddyAgent', () => {
  let mockCheckpointer: jest.Mocked<RedisCheckpointSaver>;
  let mockLlm: jest.Mocked<ChatOpenAI>;
  let agent: LanguageBuddyAgent;
  let mockAgentInvoke: jest.Mock;

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
      phone: "1234567890",
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
    mockCheckpointer = new RedisCheckpointSaver(jest.fn() as any) as jest.Mocked<RedisCheckpointSaver>;
    // Mock the internal agent directly
    mockAgentInvoke = jest.fn().mockResolvedValue({
      messages: [{ content: 'AI Response' }]
    });
    mockLlm = {
      // Mock the createReactAgent config directly if needed, or rely on its internal invoke for tests
      // For createReactAgent, the important part is its .invoke method
      // The constructor of LanguageBuddyAgent creates the agent, so we'll need to mock its .invoke
    } as any; // Cast to any to bypass strict type checking for the mock

    // When LanguageBuddyAgent is instantiated, createReactAgent is called.
    // We need to ensure the 'agent' property in LanguageBuddyAgent is a mock
    // that has an 'invoke' method.
    // A simple way to do this for unit testing `LanguageBuddyAgent` methods
    // that call `this.agent.invoke` is to dynamically replace the agent property.
    agent = new LanguageBuddyAgent(mockCheckpointer, mockLlm);
    (agent as any).agent = { invoke: mockAgentInvoke }; // Override the agent property

    jest.useFakeTimers(); // Control time for consistent test results
    mockGenerateSystemPrompt.mockReturnValue('Generated System Prompt');
    mockCheckpointer.getCheckpoint.mockResolvedValue(undefined); // Default no checkpoint
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers(); // Restore real timers
  });

  describe('getConversationDuration', () => {
    it('should return null if no checkpoint is found', async () => {
      mockCheckpointer.getCheckpoint.mockResolvedValueOnce(undefined);
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });

    it('should return null if conversationStartedAt is not in metadata', async () => {
      const checkpoint: Checkpoint = {
        channel_versions: {}, versions_seen: {}, ts: '', id: '', values: {},
      };
      mockCheckpointer.getCheckpoint.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });

    it('should calculate the correct conversation duration in minutes', async () => {
      const startedAt = DateTime.now().minus({ minutes: 30, seconds: 15 }).toISO();
      const checkpoint: Checkpoint = {
        channel_versions: {}, versions_seen: {}, ts: '', id: '', values: {},
      };
      mockCheckpointer.getCheckpoint.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: { conversationStartedAt: startedAt }, parentConfig: {}
      });

      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeCloseTo(30.25, 1); // Roughly 30 minutes and 15 seconds
    });

    it('should handle errors gracefully', async () => {
      mockCheckpointer.getCheckpoint.mockRejectedValueOnce(new Error('Redis error'));
      const duration = await agent.getConversationDuration('phone123');
      expect(duration).toBeNull();
    });
  });

  describe('getTimeSinceLastMessage', () => {
    it('should return null if no checkpoint is found', async () => {
      mockCheckpointer.getCheckpoint.mockResolvedValueOnce(undefined);
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });

    it('should return null if no messages in checkpoint', async () => {
      const checkpoint: Checkpoint = {
        channel_versions: {}, versions_seen: {}, ts: '', id: '', values: { messages: [] },
      };
      mockCheckpointer.getCheckpoint.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });

    it('should return null if last message has no timestamp', async () => {
      const checkpoint: Checkpoint = {
        channel_versions: {}, versions_seen: {}, ts: '', id: '', values: { messages: [{ content: 'hi' }] },
      };
      mockCheckpointer.getCheckpoint.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });

    it('should calculate the correct time since last message in minutes', async () => {
      const lastMessageTime = DateTime.now().minus({ hours: 1, minutes: 15 }).toISO();
      const checkpoint: Checkpoint = {
        channel_versions: {}, versions_seen: {}, ts: '', id: '', values: { messages: [{ content: 'last', timestamp: lastMessageTime }] },
      };
      mockCheckpointer.getCheckpoint.mockResolvedValueOnce({
        config: {}, checkpoint, metadata: {}, parentConfig: {}
      });

      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeCloseTo(75, 1); // 1 hour and 15 minutes
    });

    it('should handle errors gracefully', async () => {
      mockCheckpointer.getCheckpoint.mockRejectedValueOnce(new Error('Redis error'));
      const timeSince = await agent.getTimeSinceLastMessage('phone123');
      expect(timeSince).toBeNull();
    });
  });

  describe('initiateConversation', () => {
    it('should generate system prompt and invoke agent with it', async () => {
      const humanMessage = 'Hi there!';
      await agent.initiateConversation(mockSubscriber, humanMessage);

      // The conversationDurationMinutes and timeSinceLastMessageMinutes are derived from agent's own methods,
      // which internally call mockCheckpointer.getCheckpoint. We verify the final values passed to generateSystemPrompt.
      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          conversationDurationMinutes: null, // Because getCheckpoint is mocked to return undefined
          timeSinceLastMessageMinutes: null,
          currentLocalTime: expect.any(DateTime),
          lastDigestTopic: null,
        })
      );
      expect(mockAgentInvoke).toHaveBeenCalledWith(
        { messages: [expect.any(SystemMessage), expect.any(HumanMessage)] },
        { configurable: { thread_id: mockSubscriber.connections.phone }}
      );
      const invokeArgs = mockAgentInvoke.mock.calls[0][0].messages;
      expect(invokeArgs[0]).toBeInstanceOf(SystemMessage);
      expect(invokeArgs[0].content).toEqual('Generated System Prompt');
      expect(invokeArgs[1]).toBeInstanceOf(HumanMessage);
      expect(invokeArgs[1].content).toEqual(humanMessage);
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

      expect(mockGenerateSystemPrompt).not.toHaveBeenCalled();
      expect(mockAgentInvoke).toHaveBeenCalledWith(
        { messages: [expect.any(SystemMessage), expect.any(HumanMessage)] },
        { configurable: { thread_id: mockSubscriber.connections.phone }}
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
      await agent.processUserMessage(mockSubscriber, humanMessage);

      // The conversationDurationMinutes and timeSinceLastMessageMinutes are derived from agent's own methods,
      // which internally call mockCheckpointer.getCheckpoint. We verify the final values passed to generateSystemPrompt.
      expect(mockGenerateSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriber: mockSubscriber,
          conversationDurationMinutes: null,
          timeSinceLastMessageMinutes: null,
          currentLocalTime: expect.any(DateTime),
          lastDigestTopic: null,
        })
      );
      expect(mockAgentInvoke).toHaveBeenCalledWith(
        { messages: [expect.any(SystemMessage), expect.any(HumanMessage)] },
        { configurable: { thread_id: mockSubscriber.connections.phone }}
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
});