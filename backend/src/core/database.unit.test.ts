import { DatabaseService } from './database';
import path from 'path';
import fs from 'fs';
import * as crypto from 'crypto';

describe('DatabaseService', () => {
  const dbPath = path.join(__dirname, '../../data', 'test.sqlite');

  beforeEach(() => {
    // Ensure the test database file doesn't exist before each test
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  afterEach(() => {
    // Clean up the test database file after each test
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should initialize the database and enable WAL mode', () => {
    const dbService = new DatabaseService(dbPath);
    const db = dbService.getDb();

    // Check if WAL mode is enabled
    const walMode = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(walMode[0].journal_mode).toBe('wal');

    // Check if migrations table exists
    const migrationsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations';").get();
    expect(migrationsTable).toBeDefined();
    expect(migrationsTable.name).toBe('migrations');

    dbService.close();
  });

  it('should create tables specified in migrations', () => {
    const dbService = new DatabaseService(dbPath);
    const db = dbService.getDb();

    // Check if a table from the actual migrations (e.g., 'subscribers') exists
    const subscribersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscribers';").get();
    expect(subscribersTable).toBeDefined();
    expect(subscribersTable.name).toBe('subscribers');

    dbService.close();
  });

  it('should not apply the same migration twice', () => {
    let dbService = new DatabaseService(dbPath);
    dbService.close();

    // Re-initialize with the same path, should not re-apply existing migrations
    dbService = new DatabaseService(dbPath);
    const db = dbService.getDb();

    const appliedMigrations = db.prepare('SELECT name FROM migrations;').all();
    // Assuming initial migration for 'migrations' table itself is applied once.
    // The actual number depends on how DatabaseService is implemented to track its own creation.
    // For this test, we just check no duplicate entries.
    const migrationCounts: Record<string, number> = {};
    for (const migration of appliedMigrations) {
        migrationCounts[migration.name] = (migrationCounts[migration.name] || 0) + 1;
    }
    for (const name in migrationCounts) {
        expect(migrationCounts[name]).toBe(1);
    }

    dbService.close();
  });

  it('should work with an in-memory database', () => {
    const dbService = new DatabaseService(':memory:');
    const db = dbService.getDb();

    const walMode = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(walMode[0].journal_mode).toBe('memory'); // In-memory databases don't use WAL, they use MEMORY journal mode.

    const migrationsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations';").get();
    expect(migrationsTable).toBeDefined();

    dbService.close();
  });
});