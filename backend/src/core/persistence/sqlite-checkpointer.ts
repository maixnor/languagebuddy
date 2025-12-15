import * as crypto from 'node:crypto';
import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple, PendingWrite, getCheckpointId } from "@langchain/langgraph-checkpoint";
import Database from 'better-sqlite3';
import { pino } from 'pino';

const logger = pino({ name: 'SqliteCheckpointSaver' });

export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  private db: Database.Database;

  constructor(db: Database.Database) {
    super(
      // The default serializer is `JsonPlusSerializer`, which is what we need.
      // So no need to pass it explicitly.
    );
    this.db = db;
  }

  async getTuple(config: { configurable?: { thread_id?: string } }): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return undefined;

    try {
      const stmt = this.db.prepare(
        `SELECT checkpoint, metadata, parent_checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1`
      );
      const row = stmt.get(threadId) as { checkpoint: string; metadata: string; parent_checkpoint_id: string } | undefined;

      if (!row) {
        logger.debug({ threadId }, "No checkpoint found");
        return undefined;
      }

      const checkpoint: Checkpoint = JSON.parse(row.checkpoint);
      const metadata: CheckpointMetadata = JSON.parse(row.metadata || '{}');

      logger.debug({ threadId, found: true }, "Retrieved checkpoint tuple");

      return {
        config,
        checkpoint,
        metadata,
        parentConfig: row.parent_checkpoint_id ? { configurable: { thread_id: row.parent_checkpoint_id } } : undefined,
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
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    try {
      const checkpointId = getCheckpointId(config);

      // Prepare statement for insertion
      const stmt = this.db.prepare(
        `INSERT INTO checkpoint_writes (thread_id, checkpoint_id, task_id, idx, channel, type, value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // Iterate through writes and insert them
      const now = new Date().toISOString();
      for (let idx = 0; idx < writes.length; idx++) {
        const write = writes[idx];
        // PendingWrite type is `[string, any] | [string, any, string]`
        // The first element is the channel name, the second is the value.
        // The third (optional) is type.
        const channel = write[0];
        const value = write[1];
        const type = write.length === 3 ? (write[2] as string) : 'channel_write'; // Default type

        stmt.run(
          threadId,
          checkpointId,
          taskId,
          idx,
          channel,
          type,
          JSON.stringify(value), // Store value as JSON
          now
        );
      }
      logger.debug({ threadId, checkpointId, taskId, writesCount: writes.length }, "Writes saved");
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
      // Generate a new checkpoint_id (UUID)
      const checkpointId = crypto.randomUUID(); // Requires node:crypto

      // Ensure timestamp is present in messages if applicable
      // This logic is copied from RedisCheckpointSaver
      if ((checkpoint as any).values && Array.isArray((checkpoint as any).values.messages)) {
        (checkpoint as any).values.messages = (checkpoint as any).values.messages.map((message: any) => {
          if (!message.timestamp) {
            return { ...message, timestamp: new Date().toISOString() };
          }
          return message;
        });
      }

      if ((checkpoint as any).channel_values && Array.isArray((checkpoint as any).channel_values.messages)) {
        (checkpoint as any).channel_values.messages = (checkpoint as any).channel_values.messages.map((message: any) => {
          if (!message.timestamp) {
            return { ...message, timestamp: new Date().toISOString() };
          }
          return message;
        });
      }

      // Set conversationStartedAt if not already present in the metadata
      if (!(metadata as any).conversationStartedAt) {
        (metadata as any).conversationStartedAt = new Date().toISOString();
      }

      const stmt = this.db.prepare(
        `INSERT INTO checkpoints (thread_id, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      // LangGraph does not seem to pass a `type` for checkpoint. Using a default or leaving null.
      // The schema has `type TEXT`. Let's use 'checkpoint' as default.
      stmt.run(
        threadId,
        checkpointId,
        parentConfig?.configurable?.thread_id || null, // parent_checkpoint_id refers to thread_id of parent checkpoint
        'checkpoint', // default type
        JSON.stringify(checkpoint),
        JSON.stringify(metadata),
        new Date().toISOString()
      );

      logger.debug({ threadId, checkpointId }, "Checkpoint saved");
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
      // For simplicity, just return the current (latest) checkpoint
      const tuple = await this.getTuple(config);
      if (tuple) {
        yield tuple;
      }
    } catch (error) {
      logger.error({ err: error, threadId }, "Error listing checkpoints");
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!threadId) return;

    try {
      const stmt = this.db.prepare(
        `DELETE FROM checkpoints WHERE thread_id = ?`
      );
      stmt.run(threadId);

      // Also delete associated writes, if any were stored in checkpoint_writes
      const writesStmt = this.db.prepare(
        `DELETE FROM checkpoint_writes WHERE thread_id = ?`
      );
      writesStmt.run(threadId);

      logger.info({ threadId }, "Thread and associated checkpoints/writes deleted");
    } catch (error) {
      logger.error({ err: error, threadId }, "Error deleting thread");
    }
  }

  async deleteCheckpoint(phone: string): Promise<void> {
    // This method in RedisCheckpointSaver deletes all checkpoints for a phone.
    // It's essentially the same as deleteThread for our current SQLite schema.
    // The Redis version has some complex key deletion logic due to Redis key patterns.
    // For SQLite, we just delete by thread_id.
    return this.deleteThread(phone);
  }

  async deleteAllCheckpoints(): Promise<void> {
    try {
      this.db.exec(`DELETE FROM checkpoints`);
      this.db.exec(`DELETE FROM checkpoint_writes`); // Clear writes table as well
      logger.info("All checkpoints and writes deleted");
    } catch (error) {
      logger.error({ err: error }, "Error deleting all checkpoints");
    }
  }

  // This method is specific to RedisCheckpointSaver for user_digests.
  // It's not directly related to LangGraph's CheckpointSaver interface.
  // I will make it return null for now or remove it if not needed.
  // The task mentions "Digest Creation" for vocabulary extraction, etc.,
  // which might eventually need to read from a digest store.
  // But for the CheckpointSaver, it's not relevant.
  // I will remove it for now to keep the CheckpointSaver focused.
  // If `getStoredLearningData` is needed, it should be in `DigestService` or a similar service.
  // async getStoredLearningData(phoneNumber: string): Promise<any> {
  //   return null;
  // }
}
