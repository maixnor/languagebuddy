import { FeedbackService, FeedbackEntry } from './feedback.service';
import { DatabaseService } from '../../core/database';
import Database from 'better-sqlite3';

// Mock better-sqlite3 Database
class MockBetterSqlite3Database {
  private store: any[] = [];
  public insertRunMock = jest.fn(); // Expose the run mock for INSERT statements

  prepare = jest.fn((sql: string) => {
    if (sql.startsWith('INSERT')) {
      this.insertRunMock.mockImplementation((phoneNumber: string, content: string, createdAt: string) => {
        this.store.push({ phone_number: phoneNumber, content, created_at: createdAt });
        return { changes: 1 };
      });
      return {
        run: this.insertRunMock,
      };
    } else if (sql.startsWith('SELECT COUNT')) {
      return {
        get: jest.fn((phoneNumber: string, datePrefix: string) => {
          const count = this.store.filter(
            (entry) =>
              entry.phone_number === phoneNumber && entry.created_at.startsWith(datePrefix.replace(/%/g, '')),
          ).length;
          return { 'COUNT(*)': count };
        }),
      };
    } else if (sql.startsWith('SELECT content')) {
      return {
        all: jest.fn((limit: number) => {
          // Sort by created_at descending before slicing, on a copy of the array
          return [...this.store] // Create a copy
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit)
            .map((entry) => ({ content: entry.content }));
        }),
      };
    }
    return { run: jest.fn(), get: jest.fn(), all: jest.fn() };
  });

  transaction = jest.fn((fn) => fn);
  exec = jest.fn();

  // Helper to clear the store for tests
  clearStore() {
    this.store = [];
    this.insertRunMock.mockClear();
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

describe('FeedbackService', () => {
  let feedbackService: FeedbackService;
  let mockDbService: MockDatabaseService;
  let mockBetterSqlite3Db: MockBetterSqlite3Database; // Declare to access clearStore

  beforeEach(() => {
    mockDbService = new MockDatabaseService();
    mockBetterSqlite3Db = mockDbService.getDb() as unknown as MockBetterSqlite3Database; // Assign
    mockBetterSqlite3Db.clearStore(); // Clear data before each test

    // Ensure the singleton instance is reset for each test
    // @ts-ignore
    FeedbackService['instance'] = undefined;
    feedbackService = FeedbackService.getInstance(mockDbService);
  });

  it('should be defined', () => {
    expect(feedbackService).toBeDefined();
  });

  describe('saveFeedback', () => {
    it('should save feedback to the database', async () => {
      const feedback: FeedbackEntry = {
        timestamp: new Date().toISOString(),
        originalMessage: 'test message',
        userFeedback: 'great',
        userPhone: '1234567890',
        sentiment: 'positive',
        actionItems: [],
        category: 'suggestion',
      };

      await feedbackService.saveFeedback(feedback);

      const db = mockDbService.getDb();
      const mockBetterSqlite3Db = db as unknown as MockBetterSqlite3Database; // Cast to access the mock
      expect(db.prepare).toHaveBeenCalledWith('INSERT INTO feedback (phone_number, content, created_at) VALUES (?, ?, ?)');
      expect(mockBetterSqlite3Db.insertRunMock).toHaveBeenCalledWith(
        feedback.userPhone,
        JSON.stringify(feedback),
        feedback.timestamp,
      );
    });
  });

  describe('getUserFeedbackCount', () => {
    it('should return the correct feedback count for a user today', async () => {
      const today = new Date().toISOString().split('T')[0];
      const feedback1: FeedbackEntry = {
        timestamp: new Date().toISOString(),
        originalMessage: 'test message 1',
        userFeedback: 'good',
        userPhone: '1112223333',
        sentiment: 'positive',
        actionItems: [],
        category: 'content',
      };
      const feedback2: FeedbackEntry = {
        timestamp: new Date().toISOString(),
        originalMessage: 'test message 2',
        userFeedback: 'bad',
        userPhone: '1112223333',
        sentiment: 'negative',
        actionItems: [],
        category: 'technical',
      };
      const feedback3: FeedbackEntry = {
        timestamp: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString(),
        originalMessage: 'test message 3',
        userFeedback: 'old',
        userPhone: '1112223333',
        sentiment: 'neutral',
        actionItems: [],
        category: 'other',
      };

      await feedbackService.saveFeedback(feedback1);
      await feedbackService.saveFeedback(feedback2);
      await feedbackService.saveFeedback(feedback3);

      const count = await feedbackService.getUserFeedbackCount('1112223333');
      expect(count).toBe(2);

      const countOther = await feedbackService.getUserFeedbackCount('9999999999');
      expect(countOther).toBe(0);
    });
  });

  describe('getAllFeedback', () => {
    it('should retrieve all feedback entries up to the limit', async () => {
      // Use distinct timestamps to ensure predictable sorting
      const feedback1: FeedbackEntry = {
        timestamp: new Date(2025, 0, 1, 10, 0, 0).toISOString(), // Jan 1, 10:00:00
        originalMessage: 'test A',
        userFeedback: 'A',
        userPhone: '111',
        sentiment: 'positive',
        actionItems: [],
        category: 'content',
      };
      const feedback2: FeedbackEntry = {
        timestamp: new Date(2025, 0, 1, 10, 0, 1).toISOString(), // Jan 1, 10:00:01
        originalMessage: 'test B',
        userFeedback: 'B',
        userPhone: '222',
        sentiment: 'negative',
        actionItems: [],
        category: 'technical',
      };
      const feedback3: FeedbackEntry = {
        timestamp: new Date(2025, 0, 1, 10, 0, 2).toISOString(), // Jan 1, 10:00:02
        originalMessage: 'test C',
        userFeedback: 'C',
        userPhone: '333',
        sentiment: 'neutral',
        actionItems: [],
        category: 'other',
      };

      await feedbackService.saveFeedback(feedback1);
      await feedbackService.saveFeedback(feedback2);
      await feedbackService.saveFeedback(feedback3);

      const allFeedback = await feedbackService.getAllFeedback(2);
      expect(allFeedback).toHaveLength(2);
      // Now, with explicit timestamps, the order should be predictable (C, B)
      const contents = allFeedback.map(f => f.userFeedback);
      expect(contents).toEqual(['C', 'B']); // Expect C then B, as C is newest, then B
      expect(contents).not.toContain('A');
    });

    it('should return an empty array if no feedback is found', async () => {
      const allFeedback = await feedbackService.getAllFeedback();
      expect(allFeedback).toEqual([]);
    });
  });
});