export interface FeedbackEntry {
  timestamp: string;
  originalMessage: string;
  userFeedback: string;
  userPhone: string;
  sentiment: "positive" | "negative" | "neutral";
  actionItems: string[];
  category: "content" | "technical" | "suggestion" | "other";
}

import { DatabaseService } from '../../core/database';
import { pino } from 'pino';

const logger = pino({ name: 'feedback-service' });

export class FeedbackService {
  private static instance: FeedbackService;
  private db: DatabaseService;

  private constructor(db: DatabaseService) {
    this.db = db;
  }

  static getInstance(db?: DatabaseService): FeedbackService {
    if (!FeedbackService.instance) {
      if (!db) {
        throw new Error("DatabaseService instance required for first initialization");
      }
      FeedbackService.instance = new FeedbackService(db);
    }
    return FeedbackService.instance;
  }

  async saveFeedback(feedback: FeedbackEntry): Promise<void> {
    try {
      const db = this.db.getDb();
      const stmt = db.prepare('INSERT INTO feedback (phone_number, content, created_at) VALUES (?, ?, ?)');
      stmt.run(feedback.userPhone, JSON.stringify(feedback), feedback.timestamp);
      logger.info({ phoneNumber: feedback.userPhone }, `Saved feedback for user`);
    } catch (error) {
      logger.error({ err: error, feedback }, "Error saving feedback");
      throw error;
    }
  }

  async getUserFeedbackCount(phoneNumber: string): Promise<number> {
    try {
      const db = this.db.getDb();
      const today = new Date().toISOString().split('T')[0];
      const stmt = db.prepare('SELECT COUNT(*) FROM feedback WHERE phone_number = ? AND created_at LIKE ? || \'%\'');
      const result = stmt.get(phoneNumber, today) as { 'COUNT(*)': number };
      return result['COUNT(*)'];
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting user feedback count");
      return 0;
    }
  }

  async getAllFeedback(limit: number = 100): Promise<FeedbackEntry[]> {
    try {
      const db = this.db.getDb();
      const stmt = db.prepare('SELECT content FROM feedback ORDER BY created_at DESC LIMIT ?');
      const feedbackData = stmt.all(limit) as { content: string }[];
      return feedbackData.map(data => JSON.parse(data.content));
    } catch (error) {
      logger.error({ err: error }, "Error getting all feedback");
      return [];
    }
  }

  async getFeedbackAnalytics(): Promise<{
    totalFeedback: number;
    sentimentBreakdown: { positive: number; negative: number; neutral: number };
    categoryBreakdown: { [key: string]: number };
    last5Items: FeedbackEntry[];
    recentTrends: { date: string; count: number }[];
  }> {
    try {
      const allFeedback = await this.getAllFeedback(1000);
      
      const sentimentBreakdown = {
        positive: allFeedback.filter(f => f.sentiment === 'positive').length,
        negative: allFeedback.filter(f => f.sentiment === 'negative').length,
        neutral: allFeedback.filter(f => f.sentiment === 'neutral').length,
      };

      const categoryBreakdown: { [key: string]: number } = {};
      allFeedback.forEach(feedback => {
        categoryBreakdown[feedback.category] = (categoryBreakdown[feedback.category] || 0) + 1;
      });

      const last5Items = allFeedback.slice(-5).reverse();

      // Get trends for last 7 days
      const recentTrends: { date: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        const dayFeedback = allFeedback.filter(f =>
          f.timestamp.startsWith(dateStr)
        );

        recentTrends.push({
          date: dateStr,
          count: dayFeedback.length
        });
      }

      return {
        totalFeedback: allFeedback.length,
        sentimentBreakdown,
        categoryBreakdown,
        last5Items,
        recentTrends
      };
    } catch (error) {
      logger.error({ err: error }, "Error getting feedback analytics");
      return {
        totalFeedback: 0,
        sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 },
        categoryBreakdown: {},
        last5Items: [],
        recentTrends: []
      };
    }
  }
}