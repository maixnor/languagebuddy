import { BaseCheckpointSaver } from "@langchain/langgraph";
import { Checkpoint, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph";
import { Redis } from 'ioredis';
import { logger } from '../config';
import { ConversationDigest } from '../types';

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
      const checkpointData = {
        checkpoint,
        metadata,
        parentConfig,
      };

      await this.redis.set(
        `checkpoint:${threadId}`,
        JSON.stringify(checkpointData),
        'EX',
        60 * 60 * 24 * 7 // 1 week expiration
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
  ): AsyncGenerator<CheckpointTuple, any, any> {
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

  async deleteCheckpoint(threadId: string): Promise<void> {
    try {
      await this.redis.del(`checkpoint:${threadId}`);
      logger.debug({ threadId }, "Checkpoint deleted");
    } catch (error) {
      logger.error({ err: error, threadId }, "Error deleting checkpoint");
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

  // Additional methods for SubscriberService
  async saveConversationDigest(phoneNumber: string, digest: ConversationDigest): Promise<void> {
    try {
      const digestKey = `digest:${phoneNumber}:${digest.date}`;
      await this.redis.setex(
        digestKey,
        60 * 60 * 24 * 90, // 90 days expiration
        JSON.stringify(digest)
      );

      // Also add to user's digest list
      const userDigestsKey = `user_digests:${phoneNumber}`;
      await this.redis.lpush(userDigestsKey, JSON.stringify(digest));
      await this.redis.ltrim(userDigestsKey, 0, 29); // Keep last 30 digests
      await this.redis.expire(userDigestsKey, 60 * 60 * 24 * 90); // 90 days expiration

      logger.info({ phoneNumber, date: digest.date }, "Conversation digest saved");
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error saving conversation digest");
      throw error;
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

      digests.forEach((digest: ConversationDigest) => {
        if (digest.vocabulary) {
          vocabulary.push(...digest.vocabulary);
        }
        if (digest.learningProgress) {
          learningProgress.push(digest.learningProgress);
        }
        if (digest.suggestedReview) {
          suggestedReviews.push(...digest.suggestedReview);
        }
      });

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
      const threadId = `conversation:${phoneNumber}`;
      
      // Delete the main conversation checkpoint
      await this.deleteCheckpoint(threadId);
      
      // Clear any additional user-specific data (but keep digests for premium users)
      const userKeys = await this.redis.keys(`user_temp:${phoneNumber}:*`);
      if (userKeys.length > 0) {
        await this.redis.del(...userKeys);
      }

      logger.info({ phoneNumber }, "User conversation history cleared");
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error clearing user history");
      throw error;
    }
  }

  async getUserDigests(phoneNumber: string, limit: number = 10): Promise<ConversationDigest[]> {
    try {
      const userDigestsKey = `user_digests:${phoneNumber}`;
      const digestsData = await this.redis.lrange(userDigestsKey, 0, limit - 1);
      
      return digestsData.map(data => JSON.parse(data));
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting user digests");
      return [];
    }
  }
}