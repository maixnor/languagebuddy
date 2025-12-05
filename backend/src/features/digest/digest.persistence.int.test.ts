import Redis from 'ioredis';
import { RedisCheckpointSaver } from '../../persistence/redis-checkpointer';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { ChatOpenAI } from "@langchain/openai";
import { Checkpoint } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { Subscriber } from '../subscriber/subscriber.types';
import { SubscriberService } from '../subscriber/subscriber.service';

describe('Conversation Persistence & Clearance Bug', () => {
  let redis: Redis;
  let checkpointer: RedisCheckpointSaver;
  let agent: LanguageBuddyAgent;
  let mockLlm: any;
  const testPhone = 'bug-repro-phone';

  const mockSubscriber = {
    connections: { phone: testPhone },
    profile: {
      name: 'Test User',
      timezone: 'UTC',
      speakingLanguages: [],
      learningLanguages: [{ languageName: 'Spanish', overallLevel: 'Beginner' }],
      messagingPreferences: {}
    },
    metadata: {
      mistakeTolerance: 'normal',
      digests: []
    }
  } as unknown as Subscriber;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
    // Initialize SubscriberService
    SubscriberService.getInstance(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.del(`checkpoint:${testPhone}`);
    const keys = await redis.keys(`writes:${testPhone}:*`);
    if (keys.length > 0) await redis.del(...keys);

    checkpointer = new RedisCheckpointSaver(redis);
    
    // Mock LLM to inspect what messages it receives
    mockLlm = {
      invoke: jest.fn().mockResolvedValue({
        content: "I am a mock response",
        tool_calls: [],
        // LangGraph expects an AIMessage object in the response for some versions
        messages: [new AIMessage("I am a mock response")]
      }),
      bind: jest.fn().mockReturnThis(),
      withStructuredOutput: jest.fn().mockReturnThis(),
      bindTools: jest.fn().mockReturnThis(),
      modelName: 'mock-gpt-4',
      // Add other required properties if needed by the specific LangChain version
      lc_namespace: ['langchain', 'chat_models', 'openai'],
    };

    agent = new LanguageBuddyAgent(checkpointer, mockLlm as unknown as ChatOpenAI);
  });

  it('should fully clear conversation and start fresh without "resurrection"', async () => {
    // 1. Seed a conversation state directly into Redis
    // This simulates a conversation having taken place
    const messages = [
      new HumanMessage("Hello"),
      new AIMessage("Hi there"),
      new HumanMessage("I like apples")
    ];

    // Create a valid checkpoint structure that LangGraph expects
    const dummyCheckpoint: Checkpoint = {
      v: 1,
      ts: new Date().toISOString(),
      id: 'test-checkpoint-id',
      channel_values: {
        messages: messages
      },
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    };

    await checkpointer.putTuple(
      { configurable: { thread_id: testPhone } },
      dummyCheckpoint,
      { conversationStartedAt: new Date().toISOString() }
    );

    // Verify state exists
    const existsBefore = await redis.exists(`checkpoint:${testPhone}`);
    expect(existsBefore).toBe(1);
    expect(await agent.currentlyInActiveConversation(testPhone)).toBe(true);

    // 2. Execute clear command
    await agent.clearConversation(testPhone);

    // 3. Verify state is gone from Redis
    const existsAfter = await redis.exists(`checkpoint:${testPhone}`);
    expect(existsAfter).toBe(0);
    expect(await agent.currentlyInActiveConversation(testPhone)).toBe(false);

    // 4. Initiate a new conversation (simulating what happens after !clear or !night)
    await agent.initiateConversation(mockSubscriber, "New start");

    // 5. Verify what the LLM received
    // The LLM should have received the SystemMessage and the NEW HumanMessage ("New start")
    // It should NOT have received "I like apples"
    const lastCallArgs = mockLlm.bindTools.mock.calls[0] || mockLlm.invoke.mock.calls[0]; 
    // Note: implementation detail of createReactAgent might call bindTools or invoke depending on version/setup.
    // In LangGraph prebuilt agent, it usually binds tools first.
    // Let's inspect the agent execution.
    
    // Since we can't easily spy on the internal compiled graph's calls to the LLM without deep mocking,
    // let's verify the NEW checkpoint state in Redis.
    
    const newCheckpointTuple = await checkpointer.getCheckpoint(testPhone);
    expect(newCheckpointTuple).toBeDefined();
    const newMessages = newCheckpointTuple?.checkpoint.channel_values.messages;
    
    // Should contain SystemMessage + HumanMessage("New start") + AIMessage("I am a mock response")
    // Should NOT contain "I like apples"
    
    const messageContents = newMessages.map((m: any) => 
      typeof m.content === 'string' ? m.content : m.kwargs?.content
    );
    
    expect(messageContents.some((c: string) => c.includes("New start"))).toBe(true);
    expect(messageContents.some((c: string) => c.includes("I like apples"))).toBe(false);
  });
});
