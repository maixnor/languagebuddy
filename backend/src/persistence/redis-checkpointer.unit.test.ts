import { RedisCheckpointSaver } from './redis-checkpointer';
import { Redis } from 'ioredis';
import { Checkpoint } from '@langchain/langgraph';

// Mock ioredis class
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  scan: jest.fn(),
  exists: jest.fn(),
};

jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => mockRedis),
  };
});

describe('RedisCheckpointSaver', () => {
  let saver: RedisCheckpointSaver;
  let redisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient = new Redis();
    saver = new RedisCheckpointSaver(redisClient);
  });

  it('should save a checkpoint with a new conversationStartedAt if not present', async () => {
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
      pending_sends: []
    };
    const metadata = {}; // No conversationStartedAt initially

    await saver.putTuple(config, checkpoint, metadata);

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const callArgs = mockRedis.set.mock.calls[0];
    expect(callArgs[0]).toBe(`checkpoint:${threadId}`);
    const savedData = JSON.parse(callArgs[1]);
    expect(savedData.metadata.conversationStartedAt).toBeDefined();
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
      pending_sends: []
    };
    const existingStartedAt = '2023-01-01T10:00:00.000Z';
    const metadata = { conversationStartedAt: existingStartedAt };

    await saver.putTuple(config, checkpoint, metadata);

    const savedData = JSON.parse(mockRedis.set.mock.calls[0][1]);
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
      pending_sends: []
    };
    const metadata = {};

    await saver.putTuple(config, checkpoint, metadata);

    const savedData = JSON.parse(mockRedis.set.mock.calls[0][1]);
    const savedMessages = savedData.checkpoint.values.messages;

    expect(savedMessages[0].timestamp).toBeDefined();
    expect(() => new Date(savedMessages[0].timestamp)).not.toThrow();
    expect(savedMessages[1].timestamp).toEqual('2023-01-01T10:01:00.000Z'); // Should preserve existing
  });

  it('should delete checkpoint and writes keys in deleteCheckpoint', async () => {
    const phone = '1234567890';
    
    // Mock keys finding some writes
    mockRedis.exists.mockResolvedValue(1);
    mockRedis.keys.mockResolvedValue([`writes:${phone}:task1`, `writes:${phone}:task2`]);
    
    await saver.deleteCheckpoint(phone);

    // Verify main checkpoint deletion
    expect(mockRedis.del).toHaveBeenCalledWith(`checkpoint:${phone}`);
    
    // Verify writes keys search
    expect(mockRedis.keys).toHaveBeenCalledWith(`writes:${phone}:*`);
    
    // Verify writes deletion
    expect(mockRedis.del).toHaveBeenCalledWith(`writes:${phone}:task1`, `writes:${phone}:task2`);
  });

  it('should handle deleteCheckpoint when no writes exist', async () => {
    const phone = '1234567890';
    
    mockRedis.exists.mockImplementation((key: string) => {
      if (key === `checkpoint:${phone}`) {
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    });
    mockRedis.keys.mockResolvedValue([]); // No writes
    
    await saver.deleteCheckpoint(phone);

    // Verify main checkpoint deletion
    expect(mockRedis.del).toHaveBeenCalledWith(`checkpoint:${phone}`);
    
    // Verify NO writes deletion (del called only once for the main key)
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
  });
});
