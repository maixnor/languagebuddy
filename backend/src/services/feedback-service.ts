import Redis from 'ioredis';
import { FeedbackEntry } from '../types';
import { logger } from '../config';

export class FeedbackService {
  private static instance: FeedbackService;
  private redis: Redis;

  private constructor(redis: Redis) {
    this.redis = redis;
  }

  static getInstance(redis?: Redis): FeedbackService {
    if (!FeedbackService.instance) {
      if (!redis) {
        throw new Error("Redis instance required for first initialization");
      }
      FeedbackService.instance = new FeedbackService(redis);
    }
    return FeedbackService.instance;
  }

  async saveFeedback(feedback: FeedbackEntry): Promise<void> {
    try {
      // Save individual feedback entry
      const feedbackKey = `feedback:${feedback.userPhone}:${Date.now()}`;
      await this.redis.setex(feedbackKey, 90 * 24 * 60 * 60, JSON.stringify(feedback)); // 90 days

      // Add to global feedback list for analysis
      await this.redis.lpush('feedback:all', JSON.stringify(feedback));
      await this.redis.ltrim('feedback:all', 0, 999); // Keep last 1000 feedback entries

      // Track daily feedback count per user
      const today = new Date().toISOString().split('T')[0];
      const dailyCountKey = `feedback_count:${feedback.userPhone}:${today}`;
      await this.redis.incr(dailyCountKey);
      await this.redis.expire(dailyCountKey, 24 * 60 * 60); // Expire after 24 hours
      logger.info(`Saved feedback for ${feedback.userPhone.slice(-4)}`);
    } catch (error) {
      logger.error({ err: error, feedback }, "Error saving feedback");
      throw error;
    }
  }

  async getUserFeedbackCount(phoneNumber: string): Promise<number> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const dailyCountKey = `feedback_count:${phoneNumber}:${today}`;
      const count = await this.redis.get(dailyCountKey);
      return parseInt(count || '0', 10);
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting user feedback count");
      return 0;
    }
  }

  async shouldRequestFeedback(phoneNumber: string): Promise<boolean> {
    try {
      const todayCount = await this.getUserFeedbackCount(phoneNumber);
      const maxDaily = 2; // Max 2 feedback requests per day
      
      if (todayCount >= maxDaily) {
        return false;
      }

      // Random chance (1% probability)
      return Math.random() < 0.01;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error checking if should request feedback");
      return false;
    }
  }

  async getAllFeedback(limit: number = 100): Promise<FeedbackEntry[]> {
    try {
      const feedbackData = await this.redis.lrange('feedback:all', 0, limit - 1);
      return feedbackData.map(data => JSON.parse(data));
    } catch (error) {
      logger.error({ err: error }, "Error getting all feedback");
      return [];
    }
  }

  async getFeedbackByCategory(category: string, limit: number = 50): Promise<FeedbackEntry[]> {
    try {
      const allFeedback = await this.getAllFeedback(500); // Get more to filter
      return allFeedback
        .filter(feedback => feedback.category === category)
        .slice(0, limit);
    } catch (error) {
      logger.error({ err: error, category }, "Error getting feedback by category");
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