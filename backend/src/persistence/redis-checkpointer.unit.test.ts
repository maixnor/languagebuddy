import { RedisCheckpointSaver } from './redis-checkpointer';
import { Redis } from 'ioredis';
import { Checkpoint } from '@langchain/langgraph';

// Mock ioredis
jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => ({
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      lrange: jest.fn(),
    })),
  };
});

describe('RedisCheckpointSaver', () => {
  let redisMock: jest.Mocked<Redis>;
  let saver: RedisCheckpointSaver;

  beforeEach(() => {
    redisMock = new Redis() as jest.Mocked<Redis>;
    saver = new RedisCheckpointSaver(redisMock);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should save a checkpoint with a new conversationStartedAt if not present', async () => {
    const threadId = 'testThread';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      // Mock a basic checkpoint structure
      channel_versions: {},
      versions_seen: {},
      ts: '2023-01-01T00:00:00Z',
      id: 'some_id',
      // LangGraph typically stores messages in values.messages
      values: {
        messages: [{ content: 'Hello', type: 'human' }],
      },
    };
    const metadata = {}; // No conversationStartedAt initially

    await saver.putTuple(config, checkpoint, metadata);

    expect(redisMock.set).toHaveBeenCalledTimes(1);
    const savedData = JSON.parse(redisMock.set.mock.calls[0][1]);
    expect(savedData.metadata.conversationStartedAt).toBeDefined();
    // Ensure it's a valid ISO string
    expect(() => new Date(savedData.metadata.conversationStartedAt)).not.toThrow();
  });

  it('should preserve existing conversationStartedAt', async () => {
    const threadId = 'testThread';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      channel_versions: {},
      versions_seen: {},
      ts: '2023-01-01T00:00:00Z',
      id: 'some_id',
      values: {
        messages: [{ content: 'Hello', type: 'human' }],
      },
    };
    const existingStartedAt = '2023-01-01T10:00:00.000Z';
    const metadata = { conversationStartedAt: existingStartedAt };

    await saver.putTuple(config, checkpoint, metadata);

    const savedData = JSON.parse(redisMock.set.mock.calls[0][1]);
    expect(savedData.metadata.conversationStartedAt).toEqual(existingStartedAt);
  });

  it('should add timestamp to messages if not present', async () => {
    const threadId = 'testThread';
    const config = { configurable: { thread_id: threadId } };
    const checkpoint: Checkpoint = {
      channel_versions: {},
      versions_seen: {},
      ts: '2023-01-01T00:00:00Z',
      id: 'some_id',
      values: {
        messages: [
          { content: 'Message 1', type: 'human' }, // No timestamp
          { content: 'Message 2', type: 'ai', timestamp: '2023-01-01T10:01:00.000Z' }, // With timestamp
        ],
      },
    };
    const metadata = {};

    await saver.putTuple(config, checkpoint, metadata);

    const savedData = JSON.parse(redisMock.set.mock.calls[0][1]);
    const savedMessages = savedData.checkpoint.values.messages;

    expect(savedMessages[0].timestamp).toBeDefined();
    expect(() => new Date(savedMessages[0].timestamp)).not.toThrow();
    expect(savedMessages[1].timestamp).toEqual('2023-01-01T10:01:00.000Z'); // Should preserve existing
  });

  it('should not modify timestamp if already present', async () => {
    const threadId = 'testThread';
    const config = { configurable: { thread_id: threadId } };
    const existingTimestamp = '2023-01-01T09:30:00.000Z';
    const checkpoint: Checkpoint = {
      channel_versions: {},
      versions_seen: {},
      ts: '2023-01-01T00:00:00Z',
      id: 'some_id',
      values: {
        messages: [{ content: 'Existing message', type: 'human', timestamp: existingTimestamp }],
      },
    };
    const metadata = {};

    await saver.putTuple(config, checkpoint, metadata);

    const savedData = JSON.parse(redisMock.set.mock.calls[0][1]);
    const savedMessages = savedData.checkpoint.values.messages;
    expect(savedMessages[0].timestamp).toEqual(existingTimestamp);
  });

  it('should delete the entire checkpoint in clearUserHistory', async () => {
    const threadId = 'testThread';
    
    await saver.clearUserHistory(threadId);

    expect(redisMock.del).toHaveBeenCalledWith(`checkpoint:${threadId}`);
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});
