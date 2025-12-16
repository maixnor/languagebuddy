import { logger } from './observability/logging';
import Database from 'better-sqlite3';
import path from 'path';
import * as crypto from 'crypto';

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string = path.join(process.cwd(), 'data', 'languagebuddy.sqlite')) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Define initial migrations (empty for now, will add subscribers table later)
    const migrations: string[] = [
      `
      CREATE TABLE IF NOT EXISTS subscribers (
        phone_number TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active_at TEXT,
        data JSON NOT NULL
      );`,
      `
      CREATE TABLE IF NOT EXISTS daily_usage (
          phone_number TEXT NOT NULL,
          usage_date TEXT NOT NULL,
          conversation_start_count INTEGER DEFAULT 0,
          PRIMARY KEY (phone_number, usage_date),
          FOREIGN KEY (phone_number) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );`,
      `
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
      );`,
      `
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
      );`,
      `
      CREATE TABLE IF NOT EXISTS checkpoint_blobs (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        blob_id TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_id, blob_id)
      );`,
      `
      CREATE TABLE IF NOT EXISTS feedback (
        phone_number TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`,
      `
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        phone_number TEXT,
        created_at TEXT NOT NULL
      );`,
      `
      ALTER TABLE daily_usage ADD COLUMN message_count INTEGER DEFAULT 0;
      `,
      `
      ALTER TABLE daily_usage ADD COLUMN last_interaction_at TEXT;
      `
    ];

    for (const migration of migrations) {
      const hash = crypto.createHash('md5').update(migration).digest('hex');
      const migrationName = `migration_${hash}`; // Using a hash for a unique, content-derived name

      const exists = this.db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
      if (!exists) {
        try {
          this.db.exec(migration);
          this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
          logger.info(`Applied migration: ${migrationName}`);
        } catch (error: any) {
          if (error.message.includes('duplicate column name')) {
            logger.warn(`Migration ${migrationName} skipped (column already exists). Marking as applied.`);
            this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
          } else {
            throw error;
          }
        }
      }
    }
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
