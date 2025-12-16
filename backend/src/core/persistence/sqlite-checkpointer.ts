import { BaseCheckpointSaver } from "@langchain/langgraph";
import { Checkpoint, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph";
import { DatabaseService } from '../database';
import { logger } from '../../core/config';
import { randomUUID } from 'crypto';

export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    super();
    this.dbService = dbService;
    logger.info("SqliteCheckpointSaver initialized.");
  }

  async getTuple(config: { configurable?: { thread_id?: string } }): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      logger.warn("Attempted to get checkpoint with no thread_id.");
      return undefined;
    }

    try {
      const stmt = this.dbService.getDb().prepare(`
        SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at
        FROM checkpoints
        WHERE thread_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const row = stmt.get(threadId) as { 
        checkpoint_id: string;
        parent_checkpoint_id: string | null;
        type: string;
        checkpoint: string;
        metadata: string;
        created_at: string;
      } | undefined;

      if (!row) {
        logger.debug({ threadId }, "No checkpoint found for thread_id.");
        return undefined;
      }

      const checkpoint: Checkpoint = JSON.parse(row.checkpoint);
      const metadata: CheckpointMetadata = JSON.parse(row.metadata);

      logger.debug({ threadId, checkpointId: row.checkpoint_id }, "Checkpoint tuple retrieved.");

      return {
        config: { configurable: { thread_id: threadId } },
        checkpoint,
        metadata,
        parentConfig: row.parent_checkpoint_id ? { configurable: { thread_id: threadId, checkpoint_id: row.parent_checkpoint_id } } : undefined,
      };
    } catch (error) {
      logger.error({ err: error, threadId }, "Error retrieving checkpoint from SQLite.");
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

  async putTuple(
    config: { configurable?: { thread_id?: string } },
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    parentConfig?: { configurable?: { thread_id?: string, checkpoint_id?: string } } // Corrected type
  ): Promise<{ configurable?: { thread_id?: string } }> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error("Thread ID is required for checkpoint saving.");
    }

    try {
      const checkpointId = (checkpoint as any).id || randomUUID(); // LangGraph might provide id, or generate
      const parentCheckpointId = parentConfig?.configurable?.checkpoint_id || null;
      const type = (checkpoint as any).type || 'checkpoint'; // Default type if not specified

      // Ensure messages have timestamps if they don't already
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

      const serializedCheckpoint = JSON.stringify(checkpoint);
      const serializedMetadata = JSON.stringify(metadata);
      const createdAt = new Date().toISOString();

      // First, delete any existing checkpoint for this thread_id if we're saving a new one
      // This implements a "latest checkpoint only" strategy similar to the Redis version's overwrite
      this.dbService.getDb().prepare(`DELETE FROM checkpoints WHERE thread_id = ?`).run(threadId);

      const stmt = this.dbService.getDb().prepare(`
        INSERT INTO checkpoints (thread_id, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(threadId, checkpointId, parentCheckpointId, type, serializedCheckpoint, serializedMetadata, createdAt);

      logger.debug({ threadId, checkpointId }, "Checkpoint tuple saved to SQLite.");
      return config;
    } catch (error) {
      logger.error({ err: error, threadId }, "Error saving checkpoint to SQLite.");
      throw error;
    }
  }

  // TODO: Implement other methods
  async putWrites(
    config: { configurable?: { thread_id?: string } },
    writes: any[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    try {
      // LangGraph's BaseCheckpointSaver.putWrites doesn't expose checkpoint_id directly
      // This means we need to associate writes with the LATEST checkpoint for the thread
      // or derive checkpoint_id from 'config'. For now, let's assume we can query the latest checkpoint
      // or that the writes are implicitly linked to the current "active" checkpoint for the thread.
      // The Redis implementation stored writes with a separate key that included taskId, with an expiry.
      // For SQLite, we should store them in `checkpoint_writes` table.
      // If no checkpoint_id is directly available, we might need to fetch the latest for the thread.
      // However, the `checkpoint_writes` schema requires `checkpoint_id`.
      // Let's assume for `putWrites` we need `checkpoint_id` to be present in `config` or derive it.
      // Re-evaluating the `putWrites` signature: `config` is passed, which might contain `checkpoint_id`.
      // If not, this needs careful consideration of how LangGraph uses `putWrites` and its relation to checkpoints.
      
      // For now, let's try to get the latest checkpoint to associate the writes with.
      // This might not be the intended use if writes are meant to be associated with a *specific* in-flight checkpoint.
      const latestCheckpointTuple = await this.getTuple(config);
      if (!latestCheckpointTuple) {
        logger.warn({ threadId, taskId }, "No latest checkpoint found to associate writes with. Skipping writes persistence.");
        return;
      }
      const checkpointId = (latestCheckpointTuple.checkpoint as any).id || (latestCheckpointTuple.config.configurable as any)?.checkpoint_id;

      if (!checkpointId) {
        logger.warn({ threadId, taskId }, "Could not determine checkpoint_id for writes. Skipping writes persistence.");
        return;
      }

      const stmtDelete = this.dbService.getDb().prepare(`
        DELETE FROM checkpoint_writes
        WHERE thread_id = ? AND checkpoint_id = ? AND task_id = ?
      `);
      stmtDelete.run(threadId, checkpointId, taskId);

      const stmtInsert = this.dbService.getDb().prepare(`
        INSERT INTO checkpoint_writes (thread_id, checkpoint_id, task_id, idx, channel, type, value, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const createdAt = new Date().toISOString();
      writes.forEach((write: any, idx: number) => {
        // LangGraph writes typically have { channel: string, type: string, value: any } OR [channel, value] tuple
        const channel = Array.isArray(write) ? write[0] : write.channel;
        const type = (Array.isArray(write) ? null : write.type) || 'unknown';
        const value = Array.isArray(write) ? write[1] : write.value;

        stmtInsert.run(
          threadId,
          checkpointId,
          taskId,
          idx,
          channel,
          type,
          JSON.stringify(value),
          createdAt
        );
      });
      logger.debug({ threadId, checkpointId, taskId, count: writes.length }, "Writes saved to SQLite.");

    } catch (error) {
      logger.error({ err: error, threadId, taskId }, "Error saving writes to SQLite.");
    }
  }

  async *list(
    config: { configurable?: { thread_id?: string } },
    options?: { limit?: number; before?: { configurable?: { thread_id?: string, checkpoint_id?: string } } } // Corrected type
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      logger.warn("Attempted to list checkpoints with no thread_id.");
      return;
    }

    try {
      let query = `
        SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at
        FROM checkpoints
        WHERE thread_id = ?
      `;
      const params: (string | number)[] = [threadId];

      if (options?.before?.configurable?.checkpoint_id) {
        query += ` AND created_at < (SELECT created_at FROM checkpoints WHERE checkpoint_id = ?)`;
        params.push(options.before.configurable.checkpoint_id);
      }

      query += ` ORDER BY created_at DESC`;

      if (options?.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const stmt = this.dbService.getDb().prepare(query);
      const rows = stmt.all(...params) as { 
        checkpoint_id: string;
        parent_checkpoint_id: string | null;
        type: string;
        checkpoint: string;
        metadata: string;
        created_at: string;
      }[];

      for (const row of rows) {
        const checkpoint: Checkpoint = JSON.parse(row.checkpoint);
        const metadata: CheckpointMetadata = JSON.parse(row.metadata);
        
        yield {
          config: { configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id } },
          checkpoint,
          metadata,
          parentConfig: row.parent_checkpoint_id ? { configurable: { thread_id: threadId, checkpoint_id: row.parent_checkpoint_id } } : undefined,
        };
      }
      logger.debug({ threadId, count: rows.length }, "Checkpoints listed.");

    } catch (error) {
      logger.error({ err: error, threadId }, "Error listing checkpoints from SQLite.");
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    logger.info({ threadId }, "Deleting thread (all checkpoints and writes for thread_id).");
    try {
      const deleteCheckpointsStmt = this.dbService.getDb().prepare(`
        DELETE FROM checkpoints WHERE thread_id = ?
      `);
      deleteCheckpointsStmt.run(threadId);

      const deleteWritesStmt = this.dbService.getDb().prepare(`
        DELETE FROM checkpoint_writes WHERE thread_id = ?
      `);
      deleteWritesStmt.run(threadId);

      const deleteBlobsStmt = this.dbService.getDb().prepare(`
        DELETE FROM checkpoint_blobs WHERE thread_id = ?
      `);
      deleteBlobsStmt.run(threadId);

      logger.info({ threadId }, "Thread data deleted from SQLite.");
    } catch (error) {
      logger.error({ err: error, threadId }, "Error deleting thread data from SQLite.");
      throw error;
    }
  }

  async deleteCheckpoint(threadId: string, checkpointId?: string): Promise<void> {
    logger.info({ threadId, checkpointId }, "Deleting specific checkpoint or latest for thread.");
    try {
      let query: string;
      const params: string[] = [threadId];

      if (checkpointId) {
        query = `DELETE FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?`;
        params.push(checkpointId);
      } else {
        // If no specific checkpointId, delete the latest one.
        // This mirrors the Redis behavior where `deleteCheckpoint` was effectively deleting the single stored checkpoint.
        query = `
          DELETE FROM checkpoints
          WHERE thread_id = ? AND checkpoint_id = (
            SELECT checkpoint_id
            FROM checkpoints
            WHERE thread_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          )
        `;
        params.push(threadId);
      }
      this.dbService.getDb().prepare(query).run(...params);

      // Also delete associated writes and blobs for the checkpoint(s) being deleted
      // This is a bit tricky if we delete only the latest checkpoint.
      // For simplicity, let's assume `deleteCheckpoint` implicitly means delete the thread's checkpoint data.
      // If more granular deletion of writes/blobs per *specific* checkpoint_id is needed, this logic needs refinement.
      // For now, if checkpointId is provided, delete writes/blobs for that specific checkpoint.
      // If not, and we deleted the latest, then corresponding writes/blobs are likely also gone with the thread.
      // Given how Redis version treated it (deleting all for phone), `deleteThread` is more robust.
      // The `deleteCheckpoint` from Redis was really deleting the entire thread's checkpoint.
      // Let's make `deleteCheckpoint` in SQLite effectively delete the thread if no checkpointId is given,
      // aligning with the Redis-saver's behavior, which had only one checkpoint per thread anyway.

      if (!checkpointId) { // If deleting the "latest" implicitly means clearing the thread's active checkpoint
        this.dbService.getDb().prepare(`DELETE FROM checkpoint_writes WHERE thread_id = ?`).run(threadId);
        this.dbService.getDb().prepare(`DELETE FROM checkpoint_blobs WHERE thread_id = ?`).run(threadId);
      } else { // If a specific checkpointId is provided, delete its associated writes and blobs
        this.dbService.getDb().prepare(`DELETE FROM checkpoint_writes WHERE thread_id = ? AND checkpoint_id = ?`).run(threadId, checkpointId);
        this.dbService.getDb().prepare(`DELETE FROM checkpoint_blobs WHERE thread_id = ? AND checkpoint_id = ?`).run(threadId, checkpointId);
      }

      logger.info({ threadId, checkpointId }, "Checkpoint(s) and associated data deleted from SQLite.");
    } catch (error) {
      logger.error({ err: error, threadId, checkpointId }, "Error deleting checkpoint from SQLite.");
      throw error;
    }
  }


  async getCheckpoint(threadId: string): Promise<CheckpointTuple | undefined> {
    logger.debug({ threadId }, "Getting latest checkpoint for thread.");
    return this.getTuple({ configurable: { thread_id: threadId } });
  }

  async deleteAllCheckpoints(): Promise<void> {
    logger.warn("Deleting ALL checkpoints and associated writes/blobs from SQLite.");
    try {
      this.dbService.getDb().prepare(`DELETE FROM checkpoints`).run();
      this.dbService.getDb().prepare(`DELETE FROM checkpoint_writes`).run();
      this.dbService.getDb().prepare(`DELETE FROM checkpoint_blobs`).run();
      logger.info("All checkpoint data deleted from SQLite.");
    } catch (error) {
      logger.error({ err: error }, "Error deleting all checkpoint data from SQLite.");
      throw error;
    }
  }



  async clearUserHistory(phoneNumber: string): Promise<void> {
    logger.info({ phoneNumber }, "Clearing user history (deleting thread data) in SQLite.");
    await this.deleteThread(phoneNumber);
  }

  async getStoredLearningData(threadId: string): Promise<any | null> {
    return null;
  }
}