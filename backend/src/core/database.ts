import { logger } from './observability/logging';
import Database from 'better-sqlite3';
import path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath?: string) {
    let finalDbPath = dbPath;
    const defaultFallbackPath = path.join(process.cwd(), 'data', 'languagebuddy.sqlite');

    if (finalDbPath) {
      if (!fs.existsSync(finalDbPath) && finalDbPath !== ':memory:') {
        logger.warn(`Provided database path "${finalDbPath}" does not exist. Falling back to "${defaultFallbackPath}".`);
        finalDbPath = defaultFallbackPath;
      }
    } else {
      finalDbPath = defaultFallbackPath;
    }

    this.db = new Database(finalDbPath);
    this.db.pragma('foreign_keys = ON');
    // Apply WAL mode only if it's not an in-memory database
    if (finalDbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.migrate();
  }

  private migrate() {
    this.db.pragma('foreign_keys = OFF');
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
      `,
      // New Migrations for Schema Refactor
      `
      CREATE TABLE IF NOT EXISTS subscriber_languages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscriber_phone TEXT NOT NULL,
        language_name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('speaking', 'learning')),
        level TEXT,
        confidence_score INTEGER,
        data JSON,
        FOREIGN KEY (subscriber_phone) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );`,
      `
      CREATE TABLE IF NOT EXISTS digests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscriber_phone TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        topic TEXT,
        summary TEXT,
        vocabulary_json JSON,
        phrases_json JSON,
        grammar_json JSON,
        conversation_metrics_json JSON,
        assistant_mistakes_json JSON,
        user_memos_json JSON,
        FOREIGN KEY (subscriber_phone) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );`,
      `ALTER TABLE subscribers ADD COLUMN name TEXT;`,
      `ALTER TABLE subscribers ADD COLUMN timezone TEXT;`,
      `ALTER TABLE subscribers ADD COLUMN is_premium INTEGER DEFAULT 0;`,
      `ALTER TABLE subscribers ADD COLUMN is_test_user INTEGER DEFAULT 0;`,
      `ALTER TABLE subscribers ADD COLUMN last_nightly_digest_run TEXT;`,
      `ALTER TABLE subscribers ADD COLUMN streak_current INTEGER DEFAULT 0;`,
      `ALTER TABLE subscribers ADD COLUMN streak_longest INTEGER DEFAULT 0;`,
      `ALTER TABLE subscribers ADD COLUMN streak_last_increment TEXT;`,
      `
      UPDATE subscribers SET
        name = json_extract(data, '$.profile.name'),
        timezone = json_extract(data, '$.profile.timezone'),
        is_premium = COALESCE(json_extract(data, '$.isPremium'), 0),
        is_test_user = COALESCE(json_extract(data, '$.isTestUser'), 0),
        last_nightly_digest_run = json_extract(data, '$.metadata.lastNightlyDigestRun'),
        streak_current = COALESCE(json_extract(data, '$.metadata.streakData.currentStreak'), 0),
        streak_longest = COALESCE(json_extract(data, '$.metadata.streakData.longestStreak'), 0),
        streak_last_increment = json_extract(data, '$.metadata.streakData.lastIncrement');
      `,
      `
      INSERT INTO subscriber_languages (subscriber_phone, language_name, type, level, confidence_score, data)
      SELECT
        subscribers.phone_number,
        json_extract(value, '$.languageName'),
        'learning',
        json_extract(value, '$.overallLevel'),
        json_extract(value, '$.confidenceScore'),
        value
      FROM subscribers, json_each(subscribers.data, '$.profile.learningLanguages');
      `,
      `
      INSERT INTO subscriber_languages (subscriber_phone, language_name, type, level, confidence_score, data)
      SELECT
        subscribers.phone_number,
        json_extract(value, '$.languageName'),
        'speaking',
        json_extract(value, '$.overallLevel'),
        json_extract(value, '$.confidenceScore'),
        value
      FROM subscribers, json_each(subscribers.data, '$.profile.speakingLanguages');
      `,
      `
      INSERT INTO digests (subscriber_phone, timestamp, topic, summary, vocabulary_json, phrases_json, grammar_json, conversation_metrics_json, assistant_mistakes_json, user_memos_json)
      SELECT
        subscribers.phone_number,
        json_extract(value, '$.timestamp'),
        json_extract(value, '$.topic'),
        json_extract(value, '$.summary'),
        json_extract(value, '$.vocabulary'),
        json_extract(value, '$.phrases'),
        json_extract(value, '$.grammar'),
        json_extract(value, '$.conversationMetrics'),
        json_extract(value, '$.assistantMistakes'),
        json_extract(value, '$.userMemos')
      FROM subscribers, json_each(subscribers.data, '$.metadata.digests');
      `,
      // New Migrations for Digest Normalization
      `
      CREATE TABLE IF NOT EXISTS digest_assistant_mistakes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        digest_id INTEGER NOT NULL,
        original_text TEXT,
        correction TEXT,
        reason TEXT,
        FOREIGN KEY (digest_id) REFERENCES digests(id) ON DELETE CASCADE
      );`,
      `ALTER TABLE digests ADD COLUMN metric_messages_exchanged INTEGER DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_avg_response_time REAL DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_avg_msg_length REAL DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_sentence_complexity REAL DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_punctuation_accuracy REAL DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_capitalization_accuracy REAL DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_text_coherence_score REAL DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_emoji_usage REAL DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_user_initiated_topics INTEGER DEFAULT 0;`,
      `ALTER TABLE digests ADD COLUMN metric_topics_json JSON;`,
      `ALTER TABLE digests ADD COLUMN metric_abbreviations_json JSON;`,
      `
      INSERT INTO digest_assistant_mistakes (digest_id, original_text, correction, reason)
      SELECT
        digests.id,
        json_extract(value, '$.originalText'),
        json_extract(value, '$.correction'),
        json_extract(value, '$.reason')
      FROM digests, json_each(digests.assistant_mistakes_json)
      WHERE digests.assistant_mistakes_json IS NOT NULL;
      `,
      `
      UPDATE digests SET
        metric_messages_exchanged = COALESCE(json_extract(conversation_metrics_json, '$.messagesExchanged'), 0),
        metric_avg_response_time = COALESCE(json_extract(conversation_metrics_json, '$.averageResponseTime'), 0),
        metric_avg_msg_length = COALESCE(json_extract(conversation_metrics_json, '$.averageMessageLength'), 0),
        metric_sentence_complexity = COALESCE(json_extract(conversation_metrics_json, '$.sentenceComplexity'), 0),
        metric_punctuation_accuracy = COALESCE(json_extract(conversation_metrics_json, '$.punctuationAccuracy'), 0),
        metric_capitalization_accuracy = COALESCE(json_extract(conversation_metrics_json, '$.capitalizationAccuracy'), 0),
        metric_text_coherence_score = COALESCE(json_extract(conversation_metrics_json, '$.textCoherenceScore'), 0),
        metric_emoji_usage = COALESCE(json_extract(conversation_metrics_json, '$.emojiUsage'), 0),
        metric_user_initiated_topics = COALESCE(json_extract(conversation_metrics_json, '$.userInitiatedTopics'), 0),
        metric_topics_json = json_extract(conversation_metrics_json, '$.topicsDiscussed'),
        metric_abbreviations_json = json_extract(conversation_metrics_json, '$.abbreviationUsage');
      `,
      `ALTER TABLE digests DROP COLUMN assistant_mistakes_json;`,
      `ALTER TABLE digests DROP COLUMN conversation_metrics_json;`,
      // Migrations for Cascade Delete
      `
      DROP TABLE IF EXISTS processed_messages_new;
      CREATE TABLE IF NOT EXISTS processed_messages_new (
        message_id TEXT PRIMARY KEY,
        phone_number TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (phone_number) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );
      INSERT INTO processed_messages_new SELECT * FROM processed_messages;
      DROP TABLE processed_messages;
      ALTER TABLE processed_messages_new RENAME TO processed_messages;
      `,
      `
      DROP TABLE IF EXISTS feedback_new;
      CREATE TABLE IF NOT EXISTS feedback_new (
        phone_number TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (phone_number) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );
      INSERT INTO feedback_new SELECT * FROM feedback;
      DROP TABLE feedback;
      ALTER TABLE feedback_new RENAME TO feedback;
      `,
      `
      DROP TABLE IF EXISTS checkpoints_new;
      CREATE TABLE IF NOT EXISTS checkpoints_new (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, created_at DESC),
        UNIQUE (checkpoint_id),
        FOREIGN KEY (thread_id) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );
      INSERT INTO checkpoints_new SELECT * FROM checkpoints;
      DROP TABLE checkpoints;
      ALTER TABLE checkpoints_new RENAME TO checkpoints;
      `,
      `
      DROP TABLE IF EXISTS checkpoint_writes_new;
      CREATE TABLE IF NOT EXISTS checkpoint_writes_new (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_id, task_id, idx),
        FOREIGN KEY (thread_id) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );
      INSERT INTO checkpoint_writes_new SELECT * FROM checkpoint_writes;
      DROP TABLE checkpoint_writes;
      ALTER TABLE checkpoint_writes_new RENAME TO checkpoint_writes;
      `,
      `
      DROP TABLE IF EXISTS checkpoint_blobs_new;
      CREATE TABLE IF NOT EXISTS checkpoint_blobs_new (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        blob_id TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_id, blob_id),
        FOREIGN KEY (thread_id) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );
      INSERT INTO checkpoint_blobs_new SELECT * FROM checkpoint_blobs;
      DROP TABLE checkpoint_blobs;
      ALTER TABLE checkpoint_blobs_new RENAME TO checkpoint_blobs;
      `,
      `
      CREATE TABLE IF NOT EXISTS link_codes (
        code TEXT PRIMARY KEY,
        subscriber_phone TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (subscriber_phone) REFERENCES subscribers(phone_number) ON DELETE CASCADE
      );
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
    this.db.pragma('foreign_keys = ON');
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
