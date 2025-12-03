import { BaseCheckpointSaver } from "@langchain/langgraph";
import { Checkpoint, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph";
import { Redis } from 'ioredis';
import { logger } from '../config';

export class RedisCheckpointSaver extends BaseCheckpointSaver {
  private redis: Redis;

  constructor(redis: Redis) {
    super();
    this.redis = redis;
  }

  async getTuple(config: { configurable?: { thread_id?: string } }): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return undefined;

    try {
      const checkpointData = await this.redis.get(`checkpoint:${threadId}`);
      if (!checkpointData) return undefined;

      const parsed = JSON.parse(checkpointData);
      const checkpoint: Checkpoint = parsed.checkpoint;
      const metadata: CheckpointMetadata = parsed.metadata || {};

      return {
        config,
        checkpoint,
        metadata,
        parentConfig: parsed.parentConfig,
      };
    } catch (error) {
      logger.error({ err: error, threadId }, "Error retrieving checkpoint");
      return undefined;
    }
  }

  async put(
    config: { configurable?: { thread_id?: string } },
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions?: Record<string, any>
  ): Promise<{ configurable?: { thread_id?: string } }> {
    return this.putTuple(config, checkpoint, metadata);
  }

  async putWrites(
    config: { configurable?: { thread_id?: string } },
    writes: any[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    try {
      const writesKey = `writes:${threadId}:${taskId}`;
      await this.redis.setex(
        writesKey,
        60 * 60 * 24, // 1 day expiration
        JSON.stringify(writes)
      );
      logger.debug({ threadId, taskId }, "Writes saved");
    } catch (error) {
      logger.error({ err: error, threadId, taskId }, "Error saving writes");
    }
  }

  async putTuple(
    config: { configurable?: { thread_id?: string } },
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    parentConfig?: { configurable?: { thread_id?: string } }
  ): Promise<{ configurable?: { thread_id?: string } }> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) throw new Error("Thread ID is required for checkpoint saving");

    try {
      if (checkpoint.values && Array.isArray(checkpoint.values.messages)) {
        checkpoint.values.messages = checkpoint.values.messages.map((message: any) => {
          if (!message.timestamp) {
            return { ...message, timestamp: new Date().toISOString() };
          }
          return message;
        });
      }

      // Set conversationStartedAt if not already present in the metadata
      if (!metadata.conversationStartedAt) {
        metadata.conversationStartedAt = new Date().toISOString();
      }

      const checkpointData = {
        checkpoint,
        metadata,
        parentConfig,
      };

      await this.redis.set(
        `checkpoint:${threadId}`,
        JSON.stringify(checkpointData),
        'EX',
        60 * 60 * 24 * 3 // 3 days expiration
      );

      logger.debug({ threadId }, "Checkpoint saved");
      return config;
    } catch (error) {
      logger.error({ err: error, threadId }, "Error saving checkpoint");
      throw error;
    }
  }

  async *list(
    config: { configurable?: { thread_id?: string } },
    options?: { limit?: number; before?: { configurable?: { thread_id?: string } } }
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    try {
      // For simplicity, just return the current checkpoint
      const tuple = await this.getTuple(config);
      if (tuple) {
        yield tuple;
      }
    } catch (error) {
      logger.error({ err: error, threadId }, "Error listing checkpoints");
    }
  }

  async deleteCheckpoint(phone: string): Promise<void> {
    try {
      await this.redis.del(`checkpoint:${phone}`);
      logger.debug({ phone }, "Checkpoint deleted");
    } catch (error) {
      logger.error({ err: error, phone }, "Error deleting checkpoint");
    }
  }

  async getCheckpoint(phone: string): Promise<CheckpointTuple | undefined> {
    try {
      const checkpointData = await this.redis.get(`checkpoint:${phone}`);
      if (!checkpointData) return undefined;

      const parsed = JSON.parse(checkpointData);
      return {
        config: { configurable: { thread_id: phone } },
        checkpoint: parsed.checkpoint,
        metadata: parsed.metadata || {},
        parentConfig: parsed.parentConfig,
      };
    } catch (error) {
      logger.error({ err: error, threadId: phone }, "Error retrieving checkpoint");
      return undefined;
    }
  }

  async deleteAllCheckpoints(): Promise<void> {
    try {
      const keys = await this.redis.keys('checkpoint:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info({ count: keys.length }, "All checkpoints deleted");
      }
    } catch (error) {
      logger.error({ err: error }, "Error deleting all checkpoints");
    }
  }

  async getStoredLearningData(phoneNumber: string): Promise<any> {
    try {
      const userDigestsKey = `user_digests:${phoneNumber}`;
      const digestsData = await this.redis.lrange(userDigestsKey, 0, -1);
      
      if (digestsData.length === 0) {
        return null;
      }

      const digests = digestsData.map(data => JSON.parse(data));
      
      // Aggregate learning data from all digests
      const vocabulary: any[] = [];
      const learningProgress: string[] = [];
      const suggestedReviews: string[] = [];

      return {
        totalDigests: digests.length,
        vocabulary,
        learningProgress,
        suggestedReviews,
        lastDigestDate: digests[0]?.date || null
      };
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting stored learning data");
      return null;
    }
  }

  async clearUserHistory(phoneNumber: string): Promise<void> {
    try {
      const checkpointTuple = await this.getCheckpoint(phoneNumber);

      if (checkpointTuple) {
        const { checkpoint, metadata, parentConfig } = checkpointTuple;

        // Clear only the message history, assuming it's in checkpoint.values.messages
        if (checkpoint.values && Array.isArray(checkpoint.values.messages)) {
          checkpoint.values.messages = [];
        }

        await this.putTuple(
          { configurable: { thread_id: phoneNumber } },
          checkpoint,
          metadata,
          parentConfig
        );
        logger.info({ phoneNumber }, "User conversation history cleared selectively");
      } else {
        logger.info({ phoneNumber }, "No checkpoint found to clear for user");
      }
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error clearing user history selectively");
      throw error;
    }
  }
}