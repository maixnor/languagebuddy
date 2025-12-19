import { WhatsappDeduplicationService } from './whatsapp-deduplication.service';
import { DatabaseService } from '../../../core/database';
import Database from 'better-sqlite3';

// Mock better-sqlite3 Database
class MockBetterSqlite3Database {
  public store: { message_id: string; created_at: string }[] = [];
  public insertError: any = null;

  prepare = jest.fn((sql: string) => {
    if (sql.startsWith('DELETE FROM')) {
      return {
        run: jest.fn(() => {
          // Simulate deletion of old messages
          const cutoffTime = new Date(Date.now() - 2880 * 60 * 1000).toISOString();
          this.store = this.store.filter(entry => entry.created_at > cutoffTime);
          return { changes: 1 };
        }),
      };
    } else if (sql.startsWith('INSERT INTO processed_messages')) {
      return {
        run: jest.fn((message_id: string, created_at: string) => {
          if (this.insertError) {
            const error = this.insertError;
            this.insertError = null;
            throw error;
          }
          if (this.store.some(entry => entry.message_id === message_id)) {
            const error: any = new Error('SQLITE_CONSTRAINT_PRIMARYKEY');
            error.code = 'SQLITE_CONSTRAINT_PRIMARYKEY';
            throw error;
          }
          this.store.push({ message_id, created_at });
          return { changes: 1 };
        }),
      };
    }
    return { run: jest.fn(), get: jest.fn(), all: jest.fn() };
  });

  transaction = jest.fn((fn) => fn);
  exec = jest.fn();

  clearStore() {
    this.store = [];
    this.insertError = null;
  }
}

// Mock DatabaseService
class MockDatabaseService extends DatabaseService {
  private mockDb: MockBetterSqlite3Database;

  constructor() {
    super(':memory:');
    this.mockDb = new MockBetterSqlite3Database();
  }

  getDb(): Database.Database {
    return this.mockDb as unknown as Database.Database;
  }
}

describe('WhatsappDeduplicationService', () => {
  let deduplicationService: WhatsappDeduplicationService;
  let mockDbService: MockDatabaseService;
  let mockBetterSqlite3Db: MockBetterSqlite3Database;

  beforeEach(() => {
    mockDbService = new MockDatabaseService();
    mockBetterSqlite3Db = mockDbService.getDb() as unknown as MockBetterSqlite3Database;
    mockBetterSqlite3Db.clearStore();

    // @ts-ignore
    WhatsappDeduplicationService['instance'] = undefined;
    deduplicationService = WhatsappDeduplicationService.getInstance(mockDbService);
  });

  it('should be defined', () => {
    expect(deduplicationService).toBeDefined();
  });

  describe('recordMessageProcessed', () => {
    it('should record a new message as processed and return false (not duplicate)', async () => {
      const messageId = 'msg-1';

      const isDuplicate = await deduplicationService.recordMessageProcessed(messageId);

      expect(isDuplicate).toBe(false);
      expect(mockBetterSqlite3Db.store).toEqual([
        { message_id: messageId, created_at: expect.any(String) }
      ]);
    });

    it('should return true if recording a duplicate message', async () => {
      const messageId = 'msg-duplicate';

      await deduplicationService.recordMessageProcessed(messageId);
      const isDuplicate = await deduplicationService.recordMessageProcessed(messageId);
      
      expect(isDuplicate).toBe(true);
      expect(mockBetterSqlite3Db.store).toHaveLength(1);
    });

    it('should throw on database error during insert', async () => {
      const messageId = 'error-record';
      const error: any = new Error('Database insert error');
      error.code = 'SOME_OTHER_SQLITE_ERROR';
      mockBetterSqlite3Db.insertError = error;

      await expect(deduplicationService.recordMessageProcessed(messageId)).rejects.toThrow('Database insert error');
    });
  });
});