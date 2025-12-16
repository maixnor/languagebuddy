import { DatabaseService } from '../../../core/database';
import { pino } from 'pino';

const logger = pino({ name: 'WhatsappDeduplicationService' });

const MESSAGE_ID_TTL_MINUTES = 30; // 30 minutes

export class WhatsappDeduplicationService {
  private static instance: WhatsappDeduplicationService;
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }
  static getInstance(db: DatabaseService) {
    if (!WhatsappDeduplicationService.instance) {
      if (!db) {
        throw new Error("DatabaseService instance required for first initialization");
      }
      WhatsappDeduplicationService.instance = new WhatsappDeduplicationService(db);
    }
    return WhatsappDeduplicationService.instance;
  }

  async recordMessageProcessed(messageId: string, phoneNumber?: string): Promise<boolean> {
    try {
      const db = this.db.getDb();
      const now = new Date().toISOString();
      
      // Cleanup old entries before recording new one
      db.prepare(`DELETE FROM processed_messages WHERE created_at < datetime('now', '-${MESSAGE_ID_TTL_MINUTES} minutes')`).run();

      const stmt = db.prepare('INSERT INTO processed_messages (message_id, phone_number, created_at) VALUES (?, ?, ?)');
      stmt.run(messageId, phoneNumber || null, now);
      return false; // Not a duplicate
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        logger.info({ messageId }, "Attempted to record a duplicate message.");
        return true; // Is a duplicate
      }
      logger.error({ err: error, messageId, phoneNumber }, "Error recording message as processed");
      throw error;
    }
  }

}