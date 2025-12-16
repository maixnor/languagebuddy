import Database from 'better-sqlite3';
import { SqliteCheckpointSaver } from '../../core/persistence/sqlite-checkpointer';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { ChatOpenAI } from "@langchain/openai";
import { Checkpoint } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { Subscriber } from '../subscriber/subscriber.types';
import { SubscriberService } from '../subscriber/subscriber.service';
import { DigestService } from './digest.service';

describe('Conversation Persistence & Clearance Bug', () => {
  let db: Database;
  let checkpointer: SqliteCheckpointSaver;
  let agent: LanguageBuddyAgent;
  let mockLlm: any;
  let mockDigestService: DigestService;
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



  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, created_at DESC),
        UNIQUE (checkpoint_id)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_id, task_id, idx)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_blobs (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        blob_id TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_id, blob_id)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        phone_number TEXT PRIMARY KEY,
        profile TEXT,
        metadata TEXT
      );
    `);
    
    // Initialize SubscriberService with a mock DatabaseService
    // Since SubscriberService expects DatabaseService, we need to mock it
    const mockDbService = {
      getDb: () => db,
      migrate: jest.fn(),
      close: jest.fn(),
    } as any; // Using 'any' for simplicity in mock, should be more precise in real code
    SubscriberService.getInstance(mockDbService);

    checkpointer = new SqliteCheckpointSaver(mockDbService);

    
    // Mock LLM to inspect what messages it receives
    const mockLlmBase = {
      invoke: jest.fn().mockResolvedValue(new AIMessage("I am a mock response")),
      bind: jest.fn().mockReturnThis(),
      withStructuredOutput: jest.fn().mockReturnThis(),
      modelName: 'mock-gpt-4',
      lc_namespace: ['langchain', 'chat_models', 'openai'],
      bindTools: jest.fn(), // Placeholder
    };
    
    // Set up return value for bindTools to return self (or compatible mock)
    mockLlmBase.bindTools.mockReturnValue(mockLlmBase);

    mockLlm = mockLlmBase as any;

    mockDigestService = {
      getRecentDigests: jest.fn().mockResolvedValue([]),
    } as unknown as DigestService;

    agent = new LanguageBuddyAgent(checkpointer, mockLlm as unknown as ChatOpenAI, mockDigestService);
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

    await checkpointer.put(
      { configurable: { thread_id: testPhone } },
      dummyCheckpoint,
      { conversationStartedAt: new Date().toISOString() }
    );

    // Verify state exists
    const existsBefore = await checkpointer.get({ configurable: { thread_id: testPhone } });
    expect(existsBefore).toBeDefined();
    expect(await agent.currentlyInActiveConversation(testPhone)).toBe(true);

    // 2. Execute clear command
    await agent.clearConversation(testPhone);

    // 3. Verify state is gone from Redis
    const existsAfter = await checkpointer.get({ configurable: { thread_id: testPhone } });
    expect(existsAfter).toBeUndefined();
    expect(await agent.currentlyInActiveConversation(testPhone)).toBe(false);

    // 4. Initiate a new conversation (simulating what happens after !clear or !night)
    await agent.initiateConversation(mockSubscriber, "New start");

    // 5. Verify what the LLM received
    // The LLM should have received the SystemMessage and the NEW HumanMessage ("New start")
    // It should NOT have received "I like apples"
    // const lastCallArgs = mockLlm.bindTools.mock.calls[0] || mockLlm.invoke.mock.calls[0]; 
    
    // Since we can't easily spy on the internal compiled graph's calls to the LLM without deep mocking,
    // let's verify the NEW checkpoint state in Redis.
    
    // checkpointer.get() returns the Checkpoint object directly, not the Tuple
    const newCheckpoint = await checkpointer.get({ configurable: { thread_id: testPhone } });
    
    expect(newCheckpoint).toBeDefined();
    const newMessages = newCheckpoint?.channel_values.messages;
    
    // Should contain SystemMessage + HumanMessage("New start") + AIMessage("I am a mock response")
    // Should NOT contain "I like apples"
    
    const messageContents = newMessages.map((m: any) => 
      typeof m.content === 'string' ? m.content : m.kwargs?.content
    );
    
    expect(messageContents.some((c: string) => c.includes("New start"))).toBe(true);
    expect(messageContents.some((c: string) => c.includes("I like apples"))).toBe(false);
  });
});
