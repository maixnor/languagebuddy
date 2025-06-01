import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from '../config';
import { Subscriber, FeedbackEntry, VocabularyItem, ConversationDigest } from '../types';
import { SubscriberService } from '../services/subscriber-service';
import { FeedbackService } from '../services/feedback-service';

// Replace your !SUBSCRIBERDATA command system
export const updateSubscriberTool = tool(
  async ({ updates, phoneNumber }: { 
    updates: Partial<Subscriber>, 
    phoneNumber: string 
  }) => {
    try {
      const subscriberService = SubscriberService.getInstance();
      await subscriberService.updateSubscriber(phoneNumber, updates);
      
      logger.info({ phoneNumber, updates }, "Subscriber information updated via LangGraph tool");
      return "Subscriber information updated successfully";
    } catch (error) {
      logger.error({ err: error, phoneNumber, updates }, "Error updating subscriber");
      return "Failed to update subscriber information";
    }
  },
  {
    name: "update_subscriber",
    description: "Update subscriber language learning information and profile data",
    schema: z.object({
      updates: z.object({
        name: z.string().optional(),
        speakingLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string(),
          currentObjectives: z.array(z.string())
        })).optional(),
        learningLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string(),
          currentObjectives: z.array(z.string())
        })).optional(),
        timezone: z.string().optional(),
      }),
      phoneNumber: z.string(),
    }),
  }
);

// Time awareness tool for conversation context
export const checkTimeAwarenessTool = tool(
  async ({ lastMessageTime, phoneNumber }: { 
    lastMessageTime: string, 
    phoneNumber: string 
  }) => {
    try {
      const now = new Date();
      const lastTime = new Date(lastMessageTime);
      const timeDiff = now.getTime() - lastTime.getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      let timeContext = "";
      if (hoursDiff > 24) {
        const daysDiff = Math.floor(hoursDiff / 24);
        timeContext = `It's been ${daysDiff} day(s) since we last talked. Welcome back! I hope you're ready to continue your language learning journey.`;
      } else if (hoursDiff > 12) {
        timeContext = "It's been over 12 hours since we last talked. Welcome back!";
      } else if (hoursDiff > 2) {
        timeContext = `It's been ${Math.floor(hoursDiff)} hours since our last conversation.`;
      } else if (hoursDiff > 0.5) {
        timeContext = "We're continuing from where we left off earlier.";
      } else {
        timeContext = "We're in an active conversation.";
      }

      logger.info({ phoneNumber, hoursDiff, timeContext }, "Time awareness context generated");
      return timeContext;
    } catch (error) {
      logger.error({ err: error, phoneNumber, lastMessageTime }, "Error calculating time awareness");
      return "We're continuing our conversation.";
    }
  },
  {
    name: "check_time_awareness",
    description: "Check how much time has passed since last message and provide appropriate context",
    schema: z.object({
      lastMessageTime: z.string(),
      phoneNumber: z.string(),
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
      
      logger.info({ userPhone }, "Feedback collected and processed via LangGraph tool");
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

// Conversation digest creation tool
export const createConversationDigestTool = tool(
  async ({ conversationHistory, phoneNumber }: { 
    conversationHistory: string[], 
    phoneNumber: string 
  }) => {
    try {
      const vocabulary = await extractVocabulary(conversationHistory);
      const learningProgress = await assessProgress(conversationHistory);
      const suggestedReview = await generateReviewSuggestions(conversationHistory);
      const conversationSummary = await summarizeConversation(conversationHistory);
      
      const digest: ConversationDigest = {
        date: new Date().toISOString().split('T')[0],
        vocabulary,
        learningProgress,
        suggestedReview,
        conversationSummary
      };
      
      // Save digest to Redis for future premium user conversion
      const subscriberService = SubscriberService.getInstance();
      await subscriberService.saveConversationDigest(phoneNumber, digest);
      
      logger.info({ phoneNumber, vocabularyCount: vocabulary.length }, "Conversation digest created");
      return JSON.stringify(digest);
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error creating conversation digest");
      return "Failed to create conversation digest";
    }
  },
  {
    name: "create_conversation_digest",
    description: "Create a digest of the conversation for learning continuity",
    schema: z.object({
      conversationHistory: z.array(z.string()),
      phoneNumber: z.string(),
    }),
  }
);

// Check feature access tool (free vs premium)
export const checkFeatureAccessTool = tool(
  async ({ phoneNumber, feature }: { 
    phoneNumber: string, 
    feature: string 
  }) => {
    try {
      const subscriberService = SubscriberService.getInstance();
      const subscriber = await subscriberService.getSubscriber(phoneNumber);
      const hasAccess = await subscriberService.checkFeatureAccess(phoneNumber, feature);
      
      if (!hasAccess) {
        const restrictionMessage = getFeatureRestrictionMessage(feature, subscriber?.isPremium || false);
        return { hasAccess: false, message: restrictionMessage };
      }
      
      return { hasAccess: true, message: "Feature access granted" };
    } catch (error) {
      logger.error({ err: error, phoneNumber, feature }, "Error checking feature access");
      return { hasAccess: false, message: "Unable to verify feature access" };
    }
  },
  {
    name: "check_feature_access",
    description: "Check if user has access to a specific feature (free vs premium)",
    schema: z.object({
      phoneNumber: z.string(),
      feature: z.string(),
    }),
  }
);

// Helper functions for the tools
async function analyzeSentiment(feedback: string): Promise<'positive' | 'negative' | 'neutral'> {
  // Simple sentiment analysis - could be enhanced with ML
  const positiveWords = ['good', 'great', 'excellent', 'love', 'helpful', 'amazing', 'perfect'];
  const negativeWords = ['bad', 'terrible', 'hate', 'awful', 'useless', 'wrong', 'confusing'];
  
  const words = feedback.toLowerCase().split(/\s+/);
  const positiveScore = words.filter(word => positiveWords.includes(word)).length;
  const negativeScore = words.filter(word => negativeWords.includes(word)).length;
  
  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
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

async function extractVocabulary(conversationHistory: string[]): Promise<VocabularyItem[]> {
  // Extract new vocabulary from conversation
  // This would be enhanced with NLP to identify new words taught
  return [];
}

async function assessProgress(conversationHistory: string[]): Promise<string> {
  return `Progress assessment based on ${conversationHistory.length} messages in today's conversation.`;
}

async function generateReviewSuggestions(conversationHistory: string[]): Promise<string[]> {
  return ["Review today's vocabulary", "Practice the grammar concepts discussed"];
}

async function summarizeConversation(conversationHistory: string[]): Promise<string> {
  return `Conversation covered ${conversationHistory.length} exchanges focusing on language practice.`;
}

function getFeatureRestrictionMessage(feature: string, isPremium: boolean): string {
  if (isPremium) return "This feature is available to you.";
  
  const messages: Record<string, string> = {
    voice: "🎤 Voice conversations are available with our premium subscription! Upgrade to practice speaking in real-time.",
    images: "📸 Image analysis is a premium feature! Upgrade to analyze photos and practice contextual vocabulary.",
    premium_commands: "⭐ Advanced commands are available with premium! Upgrade for features like !translate, !quiz, and !practice.",
    unlimited_history: "📚 Conversation memory between sessions is a premium feature! Your learning progress is saved but not accessible in free mode."
  };
  
  return messages[feature] || "This feature requires a premium subscription to access.";
}