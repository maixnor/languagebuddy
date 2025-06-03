import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from '../config';
import { Subscriber, FeedbackEntry } from '../types';
import { SubscriberService } from '../services/subscriber-service';
import { FeedbackService } from '../services/feedback-service';

// Simple subscriber update tool
export const updateSubscriberTool = tool(
  async ({ phoneNumber, updates }: { 
    phoneNumber: string,
    updates: Partial<Subscriber>
  }) => {
    try {
      const subscriberService = SubscriberService.getInstance();
      await subscriberService.updateSubscriber(phoneNumber, updates);
      
      logger.info({ phoneNumber, updates }, "Subscriber information updated");
      return "Profile updated successfully!";
    } catch (error) {
      logger.error({ err: error, phoneNumber, updates }, "Error updating subscriber");
      return "I had trouble saving that information. Could you try again?";
    }
  },
  {
    name: "update_subscriber",
    description: "Update subscriber profile information when they share personal details",
    schema: z.object({
      phoneNumber: z.string(),
      updates: z.object({
        name: z.string().optional(),
        speakingLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string().optional(),
          currentObjectives: z.array(z.string()).optional()
        })).optional(),
        learningLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string().optional(),
          currentObjectives: z.array(z.string()).optional()
        })).optional(),
        timezone: z.string().optional(),
      })
    }),
  }
);

// Feedback collection tool
export const collectFeedbackTool = tool(
  async ({ originalMessage, userFeedback, userPhone }: { 
    originalMessage: string, 
    userFeedback: string, 
    userPhone: string 
  }) => {
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
      
      logger.info({ userPhone }, "Feedback collected and processed");
      return "Thank you for your feedback! It helps me improve our conversations.";
    } catch (error) {
      logger.error({ err: error, userPhone }, "Error collecting feedback");
      return "Thank you for the feedback! I'll make note of it.";
    }
  },
  {
    name: "collect_feedback",
    description: "Collect and process user feedback about the conversation",
    schema: z.object({
      originalMessage: z.string(),
      userFeedback: z.string(),
      userPhone: z.string(),
    }),
  }
);

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