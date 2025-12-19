import { WhatsappDeduplicationService } from './whatsapp-deduplication.service';
import { DatabaseService } from '../../../core/database';
import Database from 'better-sqlite3';

// Mock better-sqlite3 Database
class MockBetterSqlite3Database {
  public store: { message_id: string; phone_number: string | null; created_at: string }[] = [];
  public insertError: any = null; // New property to inject insert errors
  public forceForeignKeyError: boolean = false;

  prepare = jest.fn((sql: string) => {
    if (sql.startsWith('DELETE FROM')) {
      return {
        run: jest.fn(() => {
          // Simulate deletion of old messages
          const cutoffTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago
          this.store = this.store.filter(entry => entry.created_at > cutoffTime);
          return { changes: 1 };
        }),
      };
    } else if (sql.startsWith('INSERT INTO processed_messages')) {
      return {
        run: jest.fn((message_id: string, phone_number: string | null, created_at: string) => {
          if (this.forceForeignKeyError && phone_number !== null) {
            const error: any = new Error('FOREIGN KEY constraint failed');
            error.code = 'SQLITE_CONSTRAINT_FOREIGNKEY';
            throw error;
          }
          if (this.insertError) {
            const error = this.insertError;
            this.insertError = null; // Reset error after throwing
            throw error;
          }
          // Simulate unique constraint violation for duplicate messages
          if (this.store.some(entry => entry.message_id === message_id)) {
            const error: any = new Error('SQLITE_CONSTRAINT_PRIMARYKEY');
            error.code = 'SQLITE_CONSTRAINT_PRIMARYKEY';
            throw error;
          }
          this.store.push({ message_id, phone_number, created_at });
          return { changes: 1 };
        }),
      };
    } else if (sql.includes('SELECT created_at')) {
       return {
         all: jest.fn((phoneNumber: string) => {
           return this.store
             .filter(entry => entry.phone_number === phoneNumber)
             .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
             .slice(0, 2)
             .map(entry => ({ created_at: entry.created_at }));
         })
       };
    }
    return { run: jest.fn(), get: jest.fn(), all: jest.fn() };
  });

  transaction = jest.fn((fn) => fn);
  exec = jest.fn();

  // Helper to clear the store for tests
  clearStore() {
    this.store = [];
    this.insertError = null; // Reset insertError
  }
}

// Mock DatabaseService
class MockDatabaseService extends DatabaseService {
  private mockDb: MockBetterSqlite3Database;

  constructor() {
    super(':memory:'); // Use in-memory for testing
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
    mockBetterSqlite3Db.clearStore(); // Clear data before each test

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
      const phoneNumber = '1234567890';

      const isDuplicate = await deduplicationService.recordMessageProcessed(messageId, phoneNumber);

      expect(isDuplicate).toBe(false);
      // Verify insertion
      expect(mockBetterSqlite3Db.store).toEqual([
        { message_id: messageId, phone_number: phoneNumber, created_at: expect.any(String) }
      ]);
    });

    it('should return true if recording a duplicate message', async () => {
      const messageId = 'msg-duplicate';
      const phoneNumber = '1112223333';

      // Record the message once
      await deduplicationService.recordMessageProcessed(messageId, phoneNumber);

      // Attempt to record the same message again
      const isDuplicate = await deduplicationService.recordMessageProcessed(messageId, phoneNumber);
      
      expect(isDuplicate).toBe(true);
      // Only one entry should be in the store
      expect(mockBetterSqlite3Db.store).toHaveLength(1);
    });

    it('should clean up old entries when recording a new message', async () => {
      // Add an old message
      const oldMessageId = 'old-msg';
      const oldPhoneNumber = '99999';
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      mockBetterSqlite3Db.store.push({ message_id: oldMessageId, phone_number: oldPhoneNumber, created_at: thirtyOneMinutesAgo });

      expect(mockBetterSqlite3Db.store).toHaveLength(1);

      // Record a new message, which should trigger cleanup
      const newMessageId = 'new-msg';
      const newPhoneNumber = '88888';
      await deduplicationService.recordMessageProcessed(newMessageId, newPhoneNumber);

      // Old message should be gone, new message should be present
      expect(mockBetterSqlite3Db.store).toHaveLength(1);
      expect(mockBetterSqlite3Db.store[0].message_id).toBe(newMessageId);
      expect(mockBetterSqlite3Db.store.some(entry => entry.message_id === oldMessageId)).toBe(false);
    });

    it('should handle undefined phoneNumber during recording', async () => {
      const messageId = 'msg-no-phone';
      const isDuplicate = await deduplicationService.recordMessageProcessed(messageId, undefined);
      expect(isDuplicate).toBe(false);
      expect(mockBetterSqlite3Db.store[0].phone_number).toBeNull();
    });

    it('recordMessageProcessed should throw on database error during insert (other than unique constraint)', async () => {
      const messageId = 'error-record';
      const phoneNumber = '123';
      
      const error: any = new Error('Database insert error');
      error.code = 'SOME_OTHER_SQLITE_ERROR'; // Not a primary key constraint error
      mockBetterSqlite3Db.insertError = error;

      await expect(deduplicationService.recordMessageProcessed(messageId, phoneNumber)).rejects.toThrow('Database insert error');
    });

    it('should handle FOREIGN KEY constraint failed by retrying with NULL phone number', async () => {
      const messageId = 'msg-new-user';
      const phoneNumber = '1234567890';
      
      mockBetterSqlite3Db.forceForeignKeyError = true;
  
      // Should NOT throw, but return false (not duplicate)
      const isDuplicate = await deduplicationService.recordMessageProcessed(messageId, phoneNumber);
      expect(isDuplicate).toBe(false);
  
      // Verify it was stored with NULL phone number
      const stored = mockBetterSqlite3Db.store.find(m => m.message_id === messageId);
      expect(stored).toBeDefined();
      expect(stored?.phone_number).toBeNull();
    });
  });

  describe('isThrottled', () => {
    it('should return false if there are less than 2 messages', async () => {
      const phoneNumber = '5551234567';
      const isThrottled = await deduplicationService.isThrottled(phoneNumber);
      expect(isThrottled).toBe(false);
    });

    it('should return false if messages are far apart', async () => {
      const phoneNumber = '5551234567';
      
      // Add a message 5 seconds ago
      mockBetterSqlite3Db.store.push({ 
        message_id: 'msg-1', 
        phone_number: phoneNumber, 
        created_at: new Date(Date.now() - 5000).toISOString() 
      });

      // Add a message now
      mockBetterSqlite3Db.store.push({ 
        message_id: 'msg-2', 
        phone_number: phoneNumber, 
        created_at: new Date().toISOString() 
      });

      const isThrottled = await deduplicationService.isThrottled(phoneNumber);
      expect(isThrottled).toBe(false);
    });

    it('should return true if messages are close together', async () => {
      const phoneNumber = '5551234567';
      
      // Add a message 0.5 seconds ago
      mockBetterSqlite3Db.store.push({ 
        message_id: 'msg-1', 
        phone_number: phoneNumber, 
        created_at: new Date(Date.now() - 500).toISOString() 
      });

      // Add a message now
      mockBetterSqlite3Db.store.push({ 
        message_id: 'msg-2', 
        phone_number: phoneNumber, 
        created_at: new Date().toISOString() 
      });

      const isThrottled = await deduplicationService.isThrottled(phoneNumber);
      expect(isThrottled).toBe(true);
    });
  });
});
