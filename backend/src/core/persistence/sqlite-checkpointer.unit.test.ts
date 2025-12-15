import { SqliteCheckpointSaver } from './sqlite-checkpointer';
import { DatabaseService } from '../../core/database';
import Database from 'better-sqlite3';
import { Checkpoint } from '@langchain/langgraph-checkpoint'; // Use @langchain/langgraph-checkpoint

// Mock pino logger to prevent console output during tests
jest.mock('pino', () => ({
  pino: jest.fn().mockReturnValue({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

describe('SqliteCheckpointSaver', () => {
  let saver: SqliteCheckpointSaver;
  let dbService: DatabaseService;
  let db: Database.Database;

  beforeEach(() => {
    // Initialize an in-memory SQLite database for each test
    dbService = new DatabaseService(':memory:');
    db = dbService.getDb();
    dbService.migrate(); // Ensure tables are created

    saver = new SqliteCheckpointSaver(db);

    jest.clearAllMocks(); // Clear mocks for pino
  });

  afterEach(() => {
    db.close(); // Close the database connection after each test
  });

  it('should save a checkpoint with a new conversationStartedAt if not present', async () => {
    const threadId = 'testThread1';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      v: 1,
      id: 'some_id_1',
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {},
      values: {
        messages: [{ content: 'Hello', type: 'human' }],
      },
      pending_sends: []
    };
    const metadata = {}; // No conversationStartedAt initially

    await saver.putTuple(config, checkpoint, metadata);

    const row = db.prepare(`SELECT checkpoint, metadata FROM checkpoints WHERE thread_id = ?`).get(threadId) as { checkpoint: string; metadata: string } | undefined;

    expect(row).toBeDefined();
    const savedMetadata = JSON.parse(row!.metadata);
    expect(savedMetadata.conversationStartedAt).toBeDefined();
    expect(() => new Date(savedMetadata.conversationStartedAt)).not.toThrow();
  });

  it('should preserve existing conversationStartedAt', async () => {
    const threadId = 'testThread2';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      v: 1,
      id: 'some_id_2',
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {},
      values: {
        messages: [{ content: 'Hello', type: 'human' }],
      },
      pending_sends: []
    };
    const existingStartedAt = '2023-01-01T10:00:00.000Z';
    const metadata = { conversationStartedAt: existingStartedAt };

    await saver.putTuple(config, checkpoint, metadata);

    const row = db.prepare(`SELECT metadata FROM checkpoints WHERE thread_id = ?`).get(threadId) as { metadata: string } | undefined;
    expect(row).toBeDefined();
    const savedMetadata = JSON.parse(row!.metadata);
    expect(savedMetadata.conversationStartedAt).toEqual(existingStartedAt);
  });

  it('should add timestamp to messages if not present', async () => {
    const threadId = 'testThread3';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      v: 1,
      id: 'some_id_3',
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {},
      values: {
        messages: [
          { content: 'Message 1', type: 'human' }, // No timestamp
          { content: 'Message 2', type: 'ai', timestamp: '2023-01-01T10:01:00.000Z' }, // With timestamp
        ],
      },
      pending_sends: []
    };
    const metadata = {};

    await saver.putTuple(config, checkpoint, metadata);

    const row = db.prepare(`SELECT checkpoint FROM checkpoints WHERE thread_id = ?`).get(threadId) as { checkpoint: string } | undefined;
    expect(row).toBeDefined();
    const savedCheckpoint = JSON.parse(row!.checkpoint);
    const savedMessages = savedCheckpoint.values.messages;

    expect(savedMessages[0].timestamp).toBeDefined();
    expect(() => new Date(savedMessages[0].timestamp)).not.toThrow();
    expect(savedMessages[1].timestamp).toEqual('2023-01-01T10:01:00.000Z'); // Should preserve existing
  });

  it('should delete checkpoint and writes in deleteCheckpoint', async () => {
    const threadId = 'testThread4';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      v: 1,
      id: 'some_id_4',
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {},
      values: {},
      pending_sends: []
    };
    const metadata = {};

    // Save a checkpoint
    await saver.putTuple(config, checkpoint, metadata);

    // Save some writes
    const writes = [['channel1', 'value1'], ['channel2', 'value2']];
    await saver.putWrites(config, writes as any, 'task1');

    // Verify they exist
    const checkpointCountBefore = db.prepare(`SELECT COUNT(*) FROM checkpoints WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    const writesCountBefore = db.prepare(`SELECT COUNT(*) FROM checkpoint_writes WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    expect(checkpointCountBefore['COUNT(*)']).toBe(1);
    expect(writesCountBefore['COUNT(*)']).toBe(2);

    // Delete
    await saver.deleteCheckpoint(threadId);

    // Verify they are deleted
    const checkpointCountAfter = db.prepare(`SELECT COUNT(*) FROM checkpoints WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    const writesCountAfter = db.prepare(`SELECT COUNT(*) FROM checkpoint_writes WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    expect(checkpointCountAfter['COUNT(*)']).toBe(0);
    expect(writesCountAfter['COUNT(*)']).toBe(0);
  });

  it('should handle deleteCheckpoint when no writes exist', async () => {
    const threadId = 'testThread5';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      v: 1,
      id: 'some_id_5',
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {},
      values: {},
      pending_sends: []
    };
    const metadata = {};

    // Save a checkpoint
    await saver.putTuple(config, checkpoint, metadata);

    // Verify checkpoint exists, no writes
    const checkpointCountBefore = db.prepare(`SELECT COUNT(*) FROM checkpoints WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    const writesCountBefore = db.prepare(`SELECT COUNT(*) FROM checkpoint_writes WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    expect(checkpointCountBefore['COUNT(*)']).toBe(1);
    expect(writesCountBefore['COUNT(*)']).toBe(0);

    // Delete
    await saver.deleteCheckpoint(threadId);

    // Verify they are deleted
    const checkpointCountAfter = db.prepare(`SELECT COUNT(*) FROM checkpoints WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    const writesCountAfter = db.prepare(`SELECT COUNT(*) FROM checkpoint_writes WHERE thread_id = ?`).get(threadId) as { 'COUNT(*)': number };
    expect(checkpointCountAfter['COUNT(*)']).toBe(0);
    expect(writesCountAfter['COUNT(*)']).toBe(0);
  });

  it('should retrieve the latest checkpoint', async () => {
    const threadId = 'testThread6';
    const config = { configurable: { thread_id: threadId } };
    const initialCheckpoint: Checkpoint = {
      v: 1,
      id: 'initial_id',
      ts: new Date().toISOString(),
      channel_values: { someChannel: 'initialValue' },
      channel_versions: {},
      versions_seen: {},
      values: {},
      pending_sends: []
    };
    const updatedCheckpoint: Checkpoint = {
      v: 1,
      id: 'updated_id',
      ts: new Date().toISOString(),
      channel_values: { someChannel: 'updatedValue' },
      channel_versions: {},
      versions_seen: {},
      values: {},
      pending_sends: []
    };

    await saver.putTuple(config, initialCheckpoint, {});
    // Simulate a slight delay to ensure different `created_at`
    await new Promise(resolve => setTimeout(resolve, 10));
    await saver.putTuple(config, updatedCheckpoint, {});

    const tuple = await saver.getTuple(config);
    expect(tuple).toBeDefined();
    expect(tuple!.checkpoint.channel_values.someChannel).toEqual('updatedValue');
  });

  it('should delete all checkpoints and writes', async () => {
    const threadId1 = 'thread1';
    const threadId2 = 'thread2';
    const config1 = { configurable: { thread_id: threadId1 } };
    const config2 = { configurable: { thread_id: threadId2 } };
    const checkpoint1: Checkpoint = {
      v: 1, id: 'id1', ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, values: {}, pending_sends: []
    };
    const checkpoint2: Checkpoint = {
      v: 1, id: 'id2', ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {}, values: {}, pending_sends: []
    };

    await saver.putTuple(config1, checkpoint1, {});
    await saver.putWrites(config1, [['w1', 'val1']] as any, 'taskA');
    await saver.putTuple(config2, checkpoint2, {});
    await saver.putWrites(config2, [['w2', 'val2']] as any, 'taskB');

    const checkpointsBefore = db.prepare(`SELECT COUNT(*) FROM checkpoints`).get() as { 'COUNT(*)': number };
    const writesBefore = db.prepare(`SELECT COUNT(*) FROM checkpoint_writes`).get() as { 'COUNT(*)': number };
    expect(checkpointsBefore['COUNT(*)']).toBe(2);
    expect(writesBefore['COUNT(*)']).toBe(2);

    await saver.deleteAllCheckpoints();

    const checkpointsAfter = db.prepare(`SELECT COUNT(*) FROM checkpoints`).get() as { 'COUNT(*)': number };
    const writesAfter = db.prepare(`SELECT COUNT(*) FROM checkpoint_writes`).get() as { 'COUNT(*)': number };
    expect(checkpointsAfter['COUNT(*)']).toBe(0);
    expect(writesAfter['COUNT(*)']).toBe(0);
  });
});
