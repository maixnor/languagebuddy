import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Digest, Subscriber } from '../types';
import { logger } from '../config';
import { RedisCheckpointSaver } from '../persistence/redis-checkpointer';
import { SubscriberService } from './subscriber-service';

export class DigestService {
  private static instance: DigestService;
  private llm: ChatOpenAI;
  private checkpointer: RedisCheckpointSaver;
  private subscriberService: SubscriberService;

  private constructor(llm: ChatOpenAI, checkpointer: RedisCheckpointSaver, subscriberService: SubscriberService) {
    this.llm = llm;
    this.checkpointer = checkpointer;
    this.subscriberService = subscriberService;
  }

  static getInstance(llm?: ChatOpenAI, checkpointer?: RedisCheckpointSaver, subscriberService?: SubscriberService): DigestService {
    if (!DigestService.instance) {
      if (!llm || !checkpointer || !subscriberService) {
        throw new Error("LLM, checkpointer, and subscriberService are required for first initialization");
      }
      DigestService.instance = new DigestService(llm, checkpointer, subscriberService);
    }
    return DigestService.instance;
  }

  /**
   * Creates a comprehensive digest of a conversation
   */
  async createConversationDigest(subscriber: Subscriber): Promise<Digest | undefined> {
    try {
      logger.info({ phone: subscriber.connections.phone }, "Creating conversation digest");

      // Get the conversation history from Redis
      const conversationHistory = await this.getConversationHistory(subscriber.connections.phone);
      
      if (!conversationHistory || conversationHistory.length <= 1) {
        logger.warn({ phone: subscriber.connections.phone }, "No conversation history found for digest");
        return undefined;
      }

      // Create the digest using LLM analysis
      const digest = await this.analyzeConversationWithLLM(conversationHistory, subscriber);
      if (!digest) {
        logger.warn({ phone: subscriber.connections.phone }, "LLM analysis returned no digest");
        return undefined;
      }
      logger.info({ phone: subscriber.connections.phone }, "Conversation digest created successfully");
      return digest;
    } catch (error) {
      logger.error({ err: error, phone: subscriber.connections.phone }, "Error creating conversation digest");
      throw error;
    }
  }

  /**
   * Extracts conversation messages from Redis checkpoint
   */
  private async getConversationHistory(phoneNumber: string): Promise<any[]> {
    try {
      const checkpoint = await this.checkpointer.getCheckpoint(phoneNumber);
      
      if (!checkpoint || !checkpoint.checkpoint || !checkpoint.checkpoint.channel_values) {
        logger.warn({ phoneNumber }, "No checkpoint or channel values found");
        return [];
      }

      // Extract messages from the checkpoint
      const messages = checkpoint.checkpoint.channel_values.messages || [];
      
      // Ensure messages is an array before mapping
      if (!Array.isArray(messages)) {
        logger.warn({ phoneNumber, messagesType: typeof messages }, "Messages is not an array");
        return [];
      }
      
      logger.info({ phoneNumber, messageCount: messages.length }, "Extracting conversation history");
      
      // Filter and format messages for analysis
      const formattedMessages = messages.map((msg: any, index: number) => {
        // Handle different message type formats
        let messageType = 'unknown';
        
        // First check if it's a plain object with type property
        if (msg.type && typeof msg.type === 'string') {
          messageType = msg.type;
        }
        // Then check for LangChain message _getType method
        else if (msg._getType && typeof msg._getType === 'function') {
          messageType = msg._getType();
        }
        // Handle LangChain message constructor names
        else if (msg.constructor && msg.constructor.name) {
          const constructorName = msg.constructor.name.toLowerCase();
          if (constructorName.includes('human')) {
            messageType = 'human';
          } else if (constructorName.includes('ai')) {
            messageType = 'ai';
          }
        }

        const formattedMsg = {
          type: messageType,
          content: msg.content || msg.text || '',
          timestamp: msg.timestamp || new Date().toISOString()
        };
        
        logger.debug({ phoneNumber, messageIndex: index, messageType, hasContent: !!formattedMsg.content, contentLength: formattedMsg.content.length }, "Formatted message");
        return formattedMsg;
      });

      logger.info({ phoneNumber, totalMessages: formattedMessages.length, humanMessages: formattedMessages.filter(m => m.type === 'human').length }, "Conversation history extracted");
      return formattedMessages;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error extracting conversation history");
      return [];
    }
  }

  /**
   * Uses LLM to analyze conversation and extract insights
   */
  private async analyzeConversationWithLLM(conversationHistory: any[], subscriber: Subscriber): Promise<Digest | undefined> {
    const conversationText = this.formatConversationForAnalysis(conversationHistory);
    
    logger.info({ phoneNumber: subscriber.connections.phone, conversationLength: conversationText.length }, "Starting LLM analysis");
    
    const systemPrompt = this.createDigestSystemPrompt(subscriber);
    const analysisPrompt = `
Please analyze this conversation and extract the following information in JSON format:

CONVERSATION TO ANALYZE:
${conversationText}

Return a JSON object with this exact structure (ignore conversationMetrics for now):
{
  "topic": "Main topic/theme of the conversation in one sentence",
  "summary": "Comprehensive summary of what was discussed",
  "keyBreakthroughs": ["List of learning breakthroughs or achievements"],
  "areasOfStruggle": ["Areas where the user struggled or made mistakes"],
  "vocabulary": {
    "newWords": ["New words the user learned"],
    "reviewedWords": ["Words that were reviewed or practiced"],
    "struggledWith": ["Words the user had difficulty with"],
    "mastered": ["Words the user demonstrated mastery of"]
  },
  "phrases": {
    "newPhrases": ["New phrases or expressions learned"],
    "idioms": ["Idioms discussed or taught"],
    "colloquialisms": ["Informal expressions used"],
    "formalExpressions": ["Formal language patterns practiced"]
  },
  "grammar": {
    "conceptsCovered": ["Grammar concepts that were discussed"],
    "mistakesMade": ["Specific grammar mistakes the user made"],
    "patternsPracticed": ["Grammar patterns the user practiced"]
  },
  "userMemos": ["Personal information about the user that should be remembered for future conversations (interests, background, preferences, etc.)"]
}

Focus on extracting actionable learning insights and personal context that will help improve future conversations.
`;

    try {
      const result = await this.llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(analysisPrompt)
      ]);

      const response = result.content as string;
      logger.info({ phoneNumber: subscriber.connections.phone, responseLength: response.length }, "LLM analysis completed");
      
      const analysisData = this.parseAnalysisResponse(response);
      
      return {
        timestamp: new Date().toISOString(),
        topic: analysisData.topic || "General conversation",
        summary: analysisData.summary || "No summary available",
        keyBreakthroughs: analysisData.keyBreakthroughs || [],
        areasOfStruggle: analysisData.areasOfStruggle || [],
        vocabulary: {
          newWords: analysisData.vocabulary?.newWords || [],
          reviewedWords: analysisData.vocabulary?.reviewedWords || [],
          struggledWith: analysisData.vocabulary?.struggledWith || [],
          mastered: analysisData.vocabulary?.mastered || []
        },
        phrases: {
          newPhrases: analysisData.phrases?.newPhrases || [],
          idioms: analysisData.phrases?.idioms || [],
          colloquialisms: analysisData.phrases?.colloquialisms || [],
          formalExpressions: analysisData.phrases?.formalExpressions || []
        },
        grammar: {
          conceptsCovered: analysisData.grammar?.conceptsCovered || [],
          mistakesMade: analysisData.grammar?.mistakesMade || [],
          patternsPracticed: analysisData.grammar?.patternsPracticed || []
        },
        // Temporarily setting conversationMetrics to default values
        conversationMetrics: {
          messagesExchanged: conversationHistory.length,
          averageResponseTime: 0,
          topicsDiscussed: [],
          userInitiatedTopics: 0,
          averageMessageLength: 0,
          sentenceComplexity: 0,
          punctuationAccuracy: 0,
          capitalizationAccuracy: 0,
          textCoherenceScore: 0,
          emojiUsage: 0,
          abbreviationUsage: []
        },
        userMemos: analysisData.userMemos || []
      };

    } catch (error) {
      logger.error({ 
        err: error, 
        phoneNumber: subscriber.connections.phone,
        conversationLength: conversationText.length,
        humanMessageCount: conversationHistory.filter(msg => msg.type === 'human').length,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }, "Error analyzing conversation with LLM");
      return undefined; 
    }
  }

  /**
   * Creates system prompt for digest analysis
   */
  private createDigestSystemPrompt(subscriber: Subscriber): string {
    const learningLanguages = subscriber.profile.learningLanguages?.map(l => l.languageName).join(', ') || 'unknown';
    const nativeLanguages = subscriber.profile.speakingLanguages?.map(l => l.languageName).join(', ') || 'unknown';

    return `You are an expert language learning analyst. Your task is to analyze conversations between a language learning assistant and a student to extract valuable learning insights.

STUDENT PROFILE:
- Name: ${subscriber.profile.name}
- Learning: ${learningLanguages}
- Native: ${nativeLanguages}
- Current level: ${subscriber.profile.learningLanguages?.[0]?.overallLevel || 'unknown'}

ANALYSIS GUIDELINES:
1. Focus on language learning progress and patterns
2. Identify specific vocabulary and grammar points
3. Note personal information that would help customize future lessons
4. Look for areas of difficulty and breakthrough moments
5. Extract phrases and expressions that were taught or practiced
6. Identify conversation topics and user interests
7. Note any cultural context or background information shared

Be thorough but concise. Extract only meaningful learning insights.`;
  }

  /**
   * Formats conversation history for LLM analysis
   */
  private formatConversationForAnalysis(conversationHistory: any[]): string {
    return conversationHistory
      .map((msg, index) => {
        const role = msg.type === 'human' ? 'User' : 'Assistant';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');
  }

  /**
   * Parses LLM response and handles JSON extraction
   */
  private parseAnalysisResponse(response: string): any {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // If no JSON found, return empty object
      logger.warn("No valid JSON found in LLM response");
      return {};
      
    } catch (error) {
      logger.error({ err: error, response }, "Error parsing LLM analysis response");
      return {};
    }
  }

  /**
   * Saves digest to subscriber metadata and updates their profile
   */
  public async saveDigestToSubscriber(subscriber: Subscriber, digest: Digest): Promise<void> {
    try {
      // Get the latest subscriber data
      const currentSubscriber = await this.subscriberService.getSubscriber(subscriber.connections.phone);
      if (!currentSubscriber) {
        throw new Error('Subscriber not found when saving digest');
      }

      // Add digest to subscriber's metadata with proper deep merge
      const updatedSubscriber = {
        ...currentSubscriber,
        metadata: {
          ...currentSubscriber.metadata,
          digests: [...(currentSubscriber.metadata.digests || []), digest]
        }
      };

      // Update learning language data based on digest insights
      if (updatedSubscriber.profile.learningLanguages && updatedSubscriber.profile.learningLanguages.length > 0) {
        const learningLanguage = updatedSubscriber.profile.learningLanguages[0];
        
        // Update deficiencies based on areas of struggle
        const newDeficiencies = digest.areasOfStruggle.map(area => ({
          category: 'grammar' as const,
          specificArea: area,
          severity: 'moderate' as const,
          frequency: 50,
          examples: [area],
          improvementSuggestions: [`Practice ${area} more frequently`],
          firstDetected: new Date(),
          lastOccurrence: new Date()
        }));

        // Update objectives based on key breakthroughs and struggles
        const updatedObjectives = [
          ...(learningLanguage.currentObjectives || []),
          ...digest.areasOfStruggle.map(area => `Improve ${area}`)
        ].slice(0, 10); // Keep only latest 10 objectives

        const updatedLearningLanguage = {
          ...learningLanguage,
          deficiencies: [...(learningLanguage.deficiencies || []), ...newDeficiencies].slice(-20),
          currentObjectives: updatedObjectives,
          lastPracticed: new Date(),
          totalPracticeTime: (learningLanguage.totalPracticeTime || 0) + 30
        };

        updatedSubscriber.profile.learningLanguages[0] = updatedLearningLanguage;
      }

      // Save the complete updated subscriber (this replaces the whole object)
      await this.subscriberService.updateSubscriber(subscriber.connections.phone, updatedSubscriber);

    } catch (error) {
      logger.error({ err: error, phone: subscriber.connections.phone }, "Error saving digest to subscriber");
      throw error;
    }
  }

  /**
   * Retrieves recent digests for a subscriber
   */
  async getRecentDigests(phoneNumber: string, limit: number = 10): Promise<Digest[]> {
    try {
      const subscriber = await this.subscriberService.getSubscriber(phoneNumber);
      if (!subscriber || !subscriber.metadata.digests) {
        return [];
      }

      return subscriber.metadata.digests
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting recent digests");
      return [];
    }
  }

  /**
   * Gets user memos from recent digests for context
   */
  async getUserMemosFromDigests(phoneNumber: string, limit: number = 10): Promise<string[]> {
    try {
      const digests = await this.getRecentDigests(phoneNumber, limit);
      const allMemos: string[] = [];

      digests.forEach(digest => {
        if ((digest as any).userMemos) {
          allMemos.push(...(digest as any).userMemos);
        }
      });

      // Remove duplicates and return
      return [...new Set(allMemos)];

    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting user memos from digests");
      return [];
    }
  }
}
