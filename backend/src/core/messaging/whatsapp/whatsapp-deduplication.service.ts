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

  async isThrottled(phoneNumber: string): Promise<boolean> {
    const minIntervalMs = 2000; // 2 seconds
    const db = this.db.getDb();
    
    // Get the last 2 messages to compare their timestamps
    // distinct from the current message if it was just inserted
    const rows = db.prepare(`
      SELECT created_at 
      FROM processed_messages 
      WHERE phone_number = ? 
      ORDER BY created_at DESC 
      LIMIT 2
    `).all(phoneNumber) as { created_at: string }[];

    if (rows.length < 2) {
      return false; // Not enough history to throttle
    }

    const currentMsgTime = new Date(rows[0].created_at).getTime();
    const prevMsgTime = new Date(rows[1].created_at).getTime();

    return (currentMsgTime - prevMsgTime) < minIntervalMs;
  }

}