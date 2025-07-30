//@ts-nocheck
import { DynamicStructuredTool } from "@langchain/core/tools";
import { logger } from '../config';
import { FeedbackEntry } from '../types';
import { FeedbackService } from '../services/feedback-service';
import { getContextVariable } from "@langchain/core/context";
import { FeedbackContract, type FeedbackContract as FeedbackContractType } from './contracts';

let feedbackService: FeedbackService;

export function initializeFeedbackTools(redis: Redis) {
  feedbackService = FeedbackService.getInstance(redis);
}

// Helper functions for feedback analysis
async function analyzeSentiment(feedback: string): Promise<'positive' | 'negative' | 'neutral'> {
  const positiveWords = ['good', 'great', 'excellent', 'love', 'like', 'helpful', 'useful', 'amazing'];
  const negativeWords = ['bad', 'terrible', 'hate', 'dislike', 'useless', 'confusing', 'frustrating'];
  
  const lowerFeedback = feedback.toLowerCase();
  const positiveCount = positiveWords.filter(word => lowerFeedback.includes(word)).length;
  const negativeCount = negativeWords.filter(word => lowerFeedback.includes(word)).length;
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

async function extractActionItems(feedback: string): Promise<string[]> {
  const actionWords = ['should', 'could', 'need', 'want', 'improve', 'add', 'remove', 'fix'];
  const sentences = feedback.split(/[.!?]+/);
  
  return sentences.filter(sentence => 
    actionWords.some(word => sentence.toLowerCase().includes(word))
  ).map(sentence => sentence.trim()).filter(Boolean);
}

async function categorizeFeedback(feedback: string): Promise<'content' | 'technical' | 'suggestion' | 'other'> {
  const contentWords = ['grammar', 'vocabulary', 'explanation', 'language', 'teaching'];
  const technicalWords = ['bug', 'error', 'slow', 'broken', 'not working'];
  const suggestionWords = ['suggest', 'recommend', 'should add', 'would be better', 'idea'];
  
  const lowerFeedback = feedback.toLowerCase();
  
  if (suggestionWords.some(word => lowerFeedback.includes(word))) return 'suggestion';
  if (technicalWords.some(word => lowerFeedback.includes(word))) return 'technical';
  if (contentWords.some(word => lowerFeedback.includes(word))) return 'content';
  return 'other';
}

export const collectFeedbackTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "collect_feedback",
  description: "Collect and process user feedback about the conversation",
  schema: FeedbackContract,
  func: async (input: FeedbackContractType) => {
    const { originalMessage, userFeedback } = input;
    const userPhone = getContextVariable('phone') as string;
    try {
      const feedbackService = FeedbackService.getInstance();
      const feedbackEntry: FeedbackEntry = {
        timestamp: new Date().toISOString(),
        originalMessage,
        userFeedback,
        userPhone,
        sentiment: await analyzeSentiment(userFeedback),
        actionItems: await extractActionItems(userFeedback),
        category: await categorizeFeedback(userFeedback)
      };
      
      await feedbackService.saveFeedback(feedbackEntry);
      return "Thank you for your feedback! It helps me improve our conversations.";
    } catch (error) {
      logger.error({ err: error, userPhone }, "Error collecting feedback");
      return "Thank you for the feedback! I'll make note of it.";
    }
  }
});

export const feedbackTools = [
  collectFeedbackTool
];
