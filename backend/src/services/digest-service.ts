import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Digest, Subscriber } from '../types';
import { logger } from '../config';
import { RedisCheckpointSaver } from '../persistence/redis-checkpointer';
import { SubscriberService } from './subscriber-service';
import { z } from 'zod';

// Zod schema for structured output from LLM
const DigestAnalysisSchema = z.object({
  topic: z.string().describe("Main topic/theme of the conversation in one sentence"),
  summary: z.string().describe("Comprehensive summary of what was discussed"),
  keyBreakthroughs: z.array(z.string()).default([]).describe("List of learning breakthroughs or achievements"),
  areasOfStruggle: z.array(z.string()).default([]).describe("Areas where the user struggled or made mistakes"),
  vocabulary: z.object({
    newWords: z.array(z.string()).default([]).describe("New words the user learned, highlight only words the user asked about or interacted with specifically"),
    reviewedWords: z.array(z.string()).default([]).describe("Words that were practiced or repeated"),
    struggledWith: z.array(z.string()).default([]).describe("Words the user had difficulty with"),
    mastered: z.array(z.string()).default([]).describe("Words the user used that demonstrate mastery of a subject")
  }),
  phrases: z.object({
    newPhrases: z.array(z.string()).default([]).describe("New phrases or expressions learned (only ones specifically interacted by the user)"),
    idioms: z.array(z.string()).default([]).describe("Idioms discussed or taught"),
    colloquialisms: z.array(z.string()).default([]).describe("Informal expressions used"),
    formalExpressions: z.array(z.string()).default([]).describe("Formal language patterns practiced")
  }),
  grammar: z.object({
    conceptsCovered: z.array(z.string()).default([]).describe("Grammar concepts that were discussed"),
    mistakesMade: z.array(z.string()).default([]).describe("Specific grammar mistakes the user made"),
    patternsPracticed: z.array(z.string()).default([]).describe("Grammar patterns the user practiced")
  }),
  userMemos: z.array(z.string()).default([]).describe("Personal information about the user that should be remembered for future conversations (interests, background, preferences, etc.)")
});

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
    const startTime = Date.now();
    const operationId = `digest_${subscriber.connections.phone}_${Date.now()}`;
    
    try {
      logger.info({ 
        operation: 'digest.create.start',
        operationId,
        phone: subscriber.connections.phone,
        learningLanguages: subscriber.profile.learningLanguages?.map(l => l.languageName),
        userLevel: subscriber.profile.learningLanguages?.[0]?.overallLevel,
        previousDigestCount: subscriber.metadata.digests?.length || 0
      }, "Creating conversation digest");

      // Get the conversation history from Redis
      const conversationHistory = await this.getConversationHistory(subscriber.connections.phone);
      
      if (!conversationHistory || conversationHistory.length <= 1) {
        logger.warn({ 
          operation: 'digest.create.no_history',
          operationId,
          phone: subscriber.connections.phone,
          historyLength: conversationHistory?.length || 0,
          durationMs: Date.now() - startTime
        }, "No conversation history found for digest");
        return undefined;
      }

      // Create the digest using LLM analysis
      const digest = await this.analyzeConversationWithLLM(conversationHistory, subscriber);
      if (!digest) {
        logger.warn({ 
          operation: 'digest.create.llm_failed',
          operationId,
          phone: subscriber.connections.phone,
          historyLength: conversationHistory.length,
          durationMs: Date.now() - startTime
        }, "LLM analysis returned no digest");
        return undefined;
      }
      
      logger.info({ 
        operation: 'digest.create.success',
        operationId,
        phone: subscriber.connections.phone,
        durationMs: Date.now() - startTime,
        digestTopic: digest.topic,
        newWordsCount: digest.vocabulary.newWords.length,
        strugglesCount: digest.areasOfStruggle.length,
        breakthroughsCount: digest.keyBreakthroughs.length,
        userMemosCount: digest.userMemos?.length || 0,
        messagesAnalyzed: conversationHistory.length
      }, "Conversation digest created successfully");
      return digest;
    } catch (error) {
      logger.error({ 
        operation: 'digest.create.error',
        operationId,
        err: error,
        phone: subscriber.connections.phone,
        durationMs: Date.now() - startTime,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error)
      }, "Error creating conversation digest");
      throw error;
    }
  }

  /**
   * Extracts conversation messages from Redis checkpoint
   */
  private async getConversationHistory(phoneNumber: string): Promise<any[]> {
    const startTime = Date.now();
    
    try {
      const checkpoint = await this.checkpointer.getCheckpoint(phoneNumber);
      
      if (!checkpoint || !checkpoint.checkpoint || !checkpoint.checkpoint.channel_values) {
        logger.warn({ 
          operation: 'digest.history.no_checkpoint',
          phone: phoneNumber,
          hasCheckpoint: !!checkpoint,
          hasCheckpointData: !!checkpoint?.checkpoint,
          hasChannelValues: !!checkpoint?.checkpoint?.channel_values,
          durationMs: Date.now() - startTime
        }, "No checkpoint or channel values found");
        return [];
      }

      // Extract messages from the checkpoint
      const messages = checkpoint.checkpoint.channel_values.messages || [];
      
      // Ensure messages is an array before mapping
      if (!Array.isArray(messages)) {
        logger.warn({ 
          operation: 'digest.history.invalid_messages',
          phone: phoneNumber,
          messagesType: typeof messages,
          durationMs: Date.now() - startTime
        }, "Messages is not an array");
        return [];
      }
      
      logger.info({ 
        operation: 'digest.history.extract.start',
        phone: phoneNumber,
        messageCount: messages.length,
        checkpointId: checkpoint.checkpoint.id,
        durationMs: Date.now() - startTime
      }, "Extracting conversation history");
      
      // Filter and format messages for analysis
      const messageTypeStats = { human: 0, ai: 0, system: 0, unknown: 0 };
      const messageLengths: number[] = [];
      
      const formattedMessages = messages.map((msg: any, index: number) => {
        // Extract message type from LangChain serialized format: msg.id is an array like ["langchain_core", "messages", "HumanMessage"]
        let messageType = 'unknown';
        if (msg.id && Array.isArray(msg.id) && msg.id.length >= 3) {
          const messageClass = msg.id[2].toLowerCase(); // e.g., "humanmessage", "aimessage", "systemmessage"
          if (messageClass.includes('human')) {
            messageType = 'human';
          } else if (messageClass.includes('ai')) {
            messageType = 'ai';
          } else if (messageClass.includes('system')) {
            messageType = 'system';
          }
        }

        // Extract content - it's always in msg.kwargs.content based on the checkpoint structure
        let content = '';
        if (msg.kwargs?.content) {
          if (typeof msg.kwargs.content === 'string') {
            content = msg.kwargs.content;
          } else if (Array.isArray(msg.kwargs.content)) {
            // Handle array content (rich content blocks)
            content = msg.kwargs.content.map((block: any) => 
              typeof block === 'string' ? block : block.text || JSON.stringify(block)
            ).join(' ');
          }
        }

        const formattedMsg = {
          type: messageType,
          content: content || '',
          timestamp: msg.kwargs?.id || new Date().toISOString()
        };
        
        // Track statistics
        messageTypeStats[messageType as keyof typeof messageTypeStats] = (messageTypeStats[messageType as keyof typeof messageTypeStats] || 0) + 1;
        messageLengths.push(formattedMsg.content.length);
        
        logger.debug({ 
          operation: 'digest.history.message.format',
          phone: phoneNumber,
          messageIndex: index,
          messageType,
          hasContent: !!formattedMsg.content,
          contentLength: formattedMsg.content.length,
          contentPreview: formattedMsg.content.substring(0, 100)
        }, "Formatted message");
        
        return formattedMsg;
      });

      const avgMessageLength = messageLengths.length > 0 
        ? Math.round(messageLengths.reduce((a, b) => a + b, 0) / messageLengths.length)
        : 0;

      // Filter out messages with no content
      const validMessages = formattedMessages.filter(msg => msg.content && msg.content.trim().length > 0);
      
      logger.info({ 
        operation: 'digest.history.extract.complete',
        phone: phoneNumber,
        totalMessages: formattedMessages.length,
        validMessages: validMessages.length,
        emptyMessages: formattedMessages.length - validMessages.length,
        humanMessages: messageTypeStats.human,
        aiMessages: messageTypeStats.ai,
        systemMessages: messageTypeStats.system,
        unknownMessages: messageTypeStats.unknown,
        avgMessageLength,
        minMessageLength: messageLengths.length > 0 ? Math.min(...messageLengths) : 0,
        maxMessageLength: messageLengths.length > 0 ? Math.max(...messageLengths) : 0,
        durationMs: Date.now() - startTime
      }, "Conversation history extracted");
      
      if (validMessages.length === 0) {
        logger.warn({
          operation: 'digest.history.all_empty',
          phone: phoneNumber,
          totalMessages: formattedMessages.length,
          durationMs: Date.now() - startTime
        }, "All messages are empty after filtering");
      }
      
      return validMessages;
    } catch (error) {
      logger.error({ 
        operation: 'digest.history.extract.error',
        err: error,
        phone: phoneNumber,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - startTime
      }, "Error extracting conversation history");
      return [];
    }
  }

  /**
   * Uses LLM with structured output to analyze conversation and extract insights
   */
  private async analyzeConversationWithLLM(conversationHistory: any[], subscriber: Subscriber): Promise<Digest | undefined> {
    const startTime = Date.now();
    const conversationText = this.formatConversationForAnalysis(conversationHistory);
    
    logger.info({ 
      operation: 'digest.llm.analyze.start',
      phone: subscriber.connections.phone,
      conversationLength: conversationText.length,
      messageCount: conversationHistory.length,
      humanMessageCount: conversationHistory.filter(m => m.type === 'human').length,
      aiMessageCount: conversationHistory.filter(m => m.type === 'ai').length,
      learningLanguage: subscriber.profile.learningLanguages?.[0]?.languageName,
      userLevel: subscriber.profile.learningLanguages?.[0]?.overallLevel,
      modelName: this.llm.modelName || 'unknown'
    }, "Starting LLM analysis with structured output");
    
    const systemPrompt = this.createDigestSystemPrompt(subscriber);
    const analysisPrompt = `
Analyze this conversation between a language learning assistant and a student learning ${subscriber.profile.learningLanguages?.[0]?.languageName || 'a foreign language'}.

Extract key learning insights including:
- Main topic and summary of what was discussed
- Vocabulary the student learned, practiced, struggled with, or mastered
- Phrases and expressions encountered
- Grammar concepts covered and mistakes made
- Personal information about the student (interests, background, preferences, learning goals)

The conversation is text-based only. Return empty arrays for any categories with no relevant data.

CONVERSATION:
${conversationText}

Extract actionable learning insights that will help personalize future conversations.
`;

    // DEBUG: Log what's being sent to the LLM
    logger.info({
      operation: 'digest.llm.prompt.details',
      phone: subscriber.connections.phone,
      conversationTextLength: conversationText.length,
      conversationPreview: conversationText.substring(0, 1000),
      conversationMessageCount: conversationHistory.length,
      systemPromptPreview: systemPrompt.substring(0, 300),
      analysisPromptPreview: analysisPrompt.substring(0, 500)
    }, "Digest analysis prompt details");

    try {
      // Create a structured output LLM using withStructuredOutput
      // Note: This uses OpenAI's function calling under the hood
      const structuredLlm = this.llm.withStructuredOutput(DigestAnalysisSchema);
      
      const llmStartTime = Date.now();
      
      logger.debug({
        operation: 'digest.llm.invoke.start',
        phone: subscriber.connections.phone,
        modelName: this.llm.modelName,
        promptLength: analysisPrompt.length,
        systemPromptLength: systemPrompt.length
      }, "Invoking LLM with structured output");
      
      const analysisData = await structuredLlm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(analysisPrompt)
      ]);

      const llmDuration = Date.now() - llmStartTime;

      // DEBUG: Log raw response to understand what we're getting
      logger.info({
        operation: 'digest.llm.invoke.complete',
        phone: subscriber.connections.phone,
        analysisDataReceived: !!analysisData,
        analysisDataType: typeof analysisData,
        analysisDataIsNull: analysisData === null,
        analysisDataIsUndefined: analysisData === undefined,
        analysisDataKeys: analysisData ? Object.keys(analysisData) : [],
        analysisDataStringified: JSON.stringify(analysisData),
        hasTopicField: analysisData?.topic !== undefined,
        topicValue: analysisData?.topic,
        hasSummaryField: analysisData?.summary !== undefined,
        summaryValue: analysisData?.summary?.substring(0, 100)
      }, "LLM invocation completed - raw response details");

      // Validate that we got data back with meaningful content
      if (!analysisData || !analysisData.topic || !analysisData.summary) {
        logger.error({
          operation: 'digest.llm.analyze.no_data',
          phone: subscriber.connections.phone,
          durationMs: Date.now() - startTime,
          receivedData: JSON.stringify(analysisData),
          hasAnalysisData: !!analysisData,
          hasTopic: !!analysisData?.topic,
          hasSummary: !!analysisData?.summary
        }, "LLM returned no data or missing required fields");
        return undefined;
      }

      // Validate topic and summary are not empty strings
      const topicTrimmed = analysisData.topic.trim();
      const summaryTrimmed = analysisData.summary.trim();
      
      if (!topicTrimmed || !summaryTrimmed) {
        logger.error({
          operation: 'digest.llm.analyze.empty_fields',
          phone: subscriber.connections.phone,
          durationMs: Date.now() - startTime,
          topicLength: topicTrimmed.length,
          summaryLength: summaryTrimmed.length,
          receivedData: JSON.stringify(analysisData)
        }, "LLM returned empty topic or summary strings");
        return undefined;
      }

      // Validate that digest has at least some meaningful learning content
      const hasVocabulary = (analysisData.vocabulary?.newWords?.length || 0) > 0 ||
                           (analysisData.vocabulary?.reviewedWords?.length || 0) > 0 ||
                           (analysisData.vocabulary?.struggledWith?.length || 0) > 0 ||
                           (analysisData.vocabulary?.mastered?.length || 0) > 0;
      
      const hasGrammar = (analysisData.grammar?.conceptsCovered?.length || 0) > 0 ||
                        (analysisData.grammar?.mistakesMade?.length || 0) > 0 ||
                        (analysisData.grammar?.patternsPracticed?.length || 0) > 0;
      
      const hasPhrases = (analysisData.phrases?.newPhrases?.length || 0) > 0 ||
                        (analysisData.phrases?.idioms?.length || 0) > 0;
      
      const hasInsights = (analysisData.keyBreakthroughs?.length || 0) > 0 ||
                         (analysisData.areasOfStruggle?.length || 0) > 0 ||
                         (analysisData.userMemos?.length || 0) > 0;
      
      const hasMeaningfulContent = hasVocabulary || hasGrammar || hasPhrases || hasInsights || summaryTrimmed.length > 50;
      
      if (!hasMeaningfulContent) {
        logger.warn({
          operation: 'digest.llm.analyze.no_meaningful_content',
          phone: subscriber.connections.phone,
          durationMs: Date.now() - startTime,
          hasVocabulary,
          hasGrammar,
          hasPhrases,
          hasInsights,
          summaryLength: summaryTrimmed.length,
          topic: topicTrimmed,
          summary: summaryTrimmed.substring(0, 200)
        }, "Digest has no meaningful learning content - conversation may be too short or low quality");
        return undefined;
      }

      logger.info({ 
        operation: 'digest.llm.analyze.complete',
        phone: subscriber.connections.phone,
        llmDurationMs: llmDuration,
        modelName: this.llm.modelName || 'unknown',
        hasTopic: !!analysisData.topic,
        hasSummary: !!analysisData.summary,
        topicValue: analysisData.topic || 'MISSING',
        summaryLength: analysisData.summary?.length || 0,
        userMemosCount: analysisData.userMemos?.length || 0,
        newWordsCount: analysisData.vocabulary?.newWords?.length || 0
      }, "LLM structured output analysis completed");
      
      const digest = {
        timestamp: new Date().toISOString(),
        topic: analysisData.topic,
        summary: analysisData.summary,
        keyBreakthroughs: analysisData.keyBreakthroughs,
        areasOfStruggle: analysisData.areasOfStruggle,
        vocabulary: analysisData.vocabulary,
        phrases: analysisData.phrases,
        grammar: analysisData.grammar,
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
        userMemos: analysisData.userMemos
      };

      logger.info({
        operation: 'digest.llm.digest.created',
        phone: subscriber.connections.phone,
        totalDurationMs: Date.now() - startTime,
        digestTopic: digest.topic,
        summaryLength: digest.summary.length,
        newWordsCount: digest.vocabulary.newWords.length,
        reviewedWordsCount: digest.vocabulary.reviewedWords.length,
        struggledWordsCount: digest.vocabulary.struggledWith.length,
        masteredWordsCount: digest.vocabulary.mastered.length,
        newPhrasesCount: digest.phrases.newPhrases.length,
        idiomsCount: digest.phrases.idioms.length,
        grammarConceptsCount: digest.grammar.conceptsCovered.length,
        grammarMistakesCount: digest.grammar.mistakesMade.length,
        breakthroughsCount: digest.keyBreakthroughs.length,
        strugglesCount: digest.areasOfStruggle.length,
        userMemosCount: digest.userMemos.length
      }, "Digest structure created from LLM structured output");

      return digest;

    } catch (error) {
      logger.error({ 
        operation: 'digest.llm.analyze.error',
        err: error,
        phone: subscriber.connections.phone,
        conversationLength: conversationText.length,
        conversationPreview: conversationText.substring(0, 500),
        messageCount: conversationHistory.length,
        humanMessageCount: conversationHistory.filter(msg => msg.type === 'human').length,
        aiMessageCount: conversationHistory.filter(msg => msg.type === 'ai').length,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - startTime,
        modelName: this.llm.modelName || 'unknown'
      }, "Error analyzing conversation with LLM structured output");
      
      // Re-throw the error so tests can see it
      throw error;
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
   * Saves digest to subscriber metadata and updates their profile
   */
  public async saveDigestToSubscriber(subscriber: Subscriber, digest: Digest): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Validate digest before saving to prevent empty digests in Redis
      if (!digest || !digest.topic || !digest.summary || 
          digest.topic.trim().length === 0 || digest.summary.trim().length === 0) {
        logger.error({
          operation: 'digest.save.invalid_digest',
          phone: subscriber.connections.phone,
          hasDigest: !!digest,
          hasTopic: !!digest?.topic,
          hasSummary: !!digest?.summary,
          topicLength: digest?.topic?.trim().length || 0,
          summaryLength: digest?.summary?.trim().length || 0
        }, 'Attempted to save empty or invalid digest - rejected');
        throw new Error('Cannot save empty or invalid digest');
      }
      
      // Get the latest subscriber data
      const currentSubscriber = await this.subscriberService.getSubscriber(subscriber.connections.phone);
      if (!currentSubscriber) {
        logger.error({
          operation: 'digest.save.subscriber_not_found',
          phone: subscriber.connections.phone
        }, 'Subscriber not found when saving digest');
        throw new Error('Subscriber not found when saving digest');
      }

      const previousDigestCount = currentSubscriber.metadata.digests?.length || 0;

      // Add digest to subscriber's metadata with proper deep merge
      const updatedSubscriber = {
        ...currentSubscriber,
        metadata: {
          ...currentSubscriber.metadata,
          digests: [...(currentSubscriber.metadata.digests || []), digest]
        }
      };

      // Update learning language data based on digest insights
      let deficienciesAdded = 0;
      let deficienciesUpdated = 0;
      let objectivesAdded = 0;
      
      if (updatedSubscriber.profile.learningLanguages && updatedSubscriber.profile.learningLanguages.length > 0) {
        const learningLanguage = updatedSubscriber.profile.learningLanguages[0];
        
        // Track which deficiencies were practiced in this conversation
        // If grammar concepts were covered or mistakes were made, mark relevant deficiencies as practiced
        const practicedTopics = new Set<string>([
          ...(digest.grammar.conceptsCovered || []),
          ...(digest.grammar.mistakesMade || []),
          ...(digest.areasOfStruggle || [])
        ]);
        
        // Update existing deficiencies if they were practiced
        if (learningLanguage.deficiencies && learningLanguage.deficiencies.length > 0) {
          learningLanguage.deficiencies = learningLanguage.deficiencies.map(deficiency => {
            // Check if this deficiency was practiced (fuzzy match against practiced topics)
            const wasPracticed = Array.from(practicedTopics).some(topic => {
              const topicLower = topic.toLowerCase();
              const deficiencyLower = deficiency.specificArea.toLowerCase();
              
              // Direct substring match
              if (topicLower.includes(deficiencyLower) || deficiencyLower.includes(topicLower)) {
                return true;
              }
              
              // Word-level match - check if they share significant words (4+ chars or multiple 3+ char words)
              const topicWords = topicLower.split(/\s+/).filter(w => w.length >= 3);
              const deficiencyWords = deficiencyLower.split(/\s+/).filter(w => w.length >= 3);
              
              // Count matching words
              let matchCount = 0;
              let hasLongMatch = false;
              
              for (const tw of topicWords) {
                for (const dw of deficiencyWords) {
                  if (tw === dw || tw.includes(dw) || dw.includes(tw)) {
                    matchCount++;
                    if (tw.length >= 5 || dw.length >= 5) {
                      hasLongMatch = true;
                    }
                  }
                }
              }
              
              // Match if we have a long word match OR multiple short word matches
              return hasLongMatch || matchCount >= 2;
            });
            
            if (wasPracticed) {
              deficienciesUpdated++;
              return {
                ...deficiency,
                lastPracticedAt: new Date(),
                practiceCount: (deficiency.practiceCount || 0) + 1
              };
            }
            return deficiency;
          });
        }
        
        // Update deficiencies based on areas of struggle
        const newDeficiencies = digest.areasOfStruggle
          .filter(area => {
            // Only add if not already tracked
            return !learningLanguage.deficiencies?.some(def => 
              def.specificArea.toLowerCase() === area.toLowerCase()
            );
          })
          .map(area => ({
            category: 'grammar' as const,
            specificArea: area,
            severity: 'moderate' as const,
            frequency: 50,
            examples: [area],
            improvementSuggestions: [`Practice ${area} more frequently`],
            firstDetected: new Date(),
            lastOccurrence: new Date(),
            practiceCount: 0
          }));
        deficienciesAdded = newDeficiencies.length;

        // Update objectives based on key breakthroughs and struggles
        const newObjectivesFromStruggles = digest.areasOfStruggle.map(area => `Improve ${area}`);
        const updatedObjectives = [
          ...(learningLanguage.currentObjectives || []),
          ...newObjectivesFromStruggles
        ].slice(0, 10); // Keep only latest 10 objectives
        objectivesAdded = newObjectivesFromStruggles.length;

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

      logger.info({
        operation: 'digest.save.success',
        phone: subscriber.connections.phone,
        previousDigestCount,
        newDigestCount: updatedSubscriber.metadata.digests.length,
        deficienciesAdded,
        deficienciesUpdated,
        objectivesAdded,
        digestTopic: digest.topic,
        durationMs: Date.now() - startTime
      }, "Digest saved to subscriber successfully");

    } catch (error) {
      logger.error({ 
        operation: 'digest.save.error',
        err: error,
        phone: subscriber.connections.phone,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      }, "Error saving digest to subscriber");
      throw error;
    }
  }

  /**
   * Retrieves recent digests for a subscriber
   */
  async getRecentDigests(phoneNumber: string, limit: number = 10): Promise<Digest[]> {
    const startTime = Date.now();
    
    try {
      const subscriber = await this.subscriberService.getSubscriber(phoneNumber);
      if (!subscriber || !subscriber.metadata.digests) {
        logger.debug({
          operation: 'digest.get_recent.no_digests',
          phone: phoneNumber,
          hasSubscriber: !!subscriber,
          hasMetadata: !!subscriber?.metadata,
          durationMs: Date.now() - startTime
        }, "No digests found for subscriber");
        return [];
      }

      const digests = subscriber.metadata.digests
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

      logger.debug({
        operation: 'digest.get_recent.success',
        phone: phoneNumber,
        totalDigests: subscriber.metadata.digests.length,
        returnedDigests: digests.length,
        limit,
        oldestDigestTimestamp: digests[digests.length - 1]?.timestamp,
        newestDigestTimestamp: digests[0]?.timestamp,
        durationMs: Date.now() - startTime
      }, "Retrieved recent digests");

      return digests;

    } catch (error) {
      logger.error({ 
        operation: 'digest.get_recent.error',
        err: error,
        phone: phoneNumber,
        limit,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      }, "Error getting recent digests");
      return [];
    }
  }

  /**
   * Gets user memos from recent digests for context
   */
  async getUserMemosFromDigests(phoneNumber: string, limit: number = 10): Promise<string[]> {
    const startTime = Date.now();
    
    try {
      const digests = await this.getRecentDigests(phoneNumber, limit);
      const allMemos: string[] = [];
      let digestsWithMemos = 0;

      digests.forEach(digest => {
        if ((digest as any).userMemos) {
          const memoCount = (digest as any).userMemos.length;
          if (memoCount > 0) {
            digestsWithMemos++;
          }
          allMemos.push(...(digest as any).userMemos);
        }
      });

      // Remove duplicates and return
      const uniqueMemos = [...new Set(allMemos)];

      logger.debug({
        operation: 'digest.get_memos.success',
        phone: phoneNumber,
        digestsChecked: digests.length,
        digestsWithMemos,
        totalMemos: allMemos.length,
        uniqueMemos: uniqueMemos.length,
        duplicatesRemoved: allMemos.length - uniqueMemos.length,
        limit,
        durationMs: Date.now() - startTime
      }, "Retrieved user memos from digests");

      return uniqueMemos;

    } catch (error) {
      logger.error({ 
        operation: 'digest.get_memos.error',
        err: error,
        phone: phoneNumber,
        limit,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      }, "Error getting user memos from digests");
      return [];
    }
  }

  /**
   * Removes digests older than the specified number of days
   * @param phoneNumber - User's phone number
   * @param daysToKeep - Number of days to keep digests (default: 10)
   * @returns Number of digests removed
   */
  async removeOldDigests(phoneNumber: string, daysToKeep: number = 10): Promise<number> {
    const startTime = Date.now();
    
    try {
      const subscriber = await this.subscriberService.getSubscriber(phoneNumber);
      if (!subscriber) {
        logger.warn({
          operation: 'digest.cleanup.no_subscriber',
          phone: phoneNumber,
          durationMs: Date.now() - startTime
        }, "No subscriber found for digest cleanup");
        return 0;
      }

      const digests = subscriber.metadata?.digests || [];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const initialCount = digests.length;
      const recentDigests = digests.filter(digest => {
        const digestDate = new Date(digest.timestamp);
        return digestDate >= cutoffDate;
      });

      const removedCount = initialCount - recentDigests.length;

      if (removedCount > 0) {
        await this.subscriberService.updateSubscriber(phoneNumber, {
          metadata: {
            ...subscriber.metadata,
            digests: recentDigests
          }
        });

        logger.info({
          operation: 'digest.cleanup.success',
          phone: phoneNumber,
          initialCount,
          removedCount,
          remainingCount: recentDigests.length,
          daysToKeep,
          cutoffDate: cutoffDate.toISOString(),
          durationMs: Date.now() - startTime
        }, `Removed ${removedCount} old digest(s)`);
      } else {
        logger.debug({
          operation: 'digest.cleanup.no_removal',
          phone: phoneNumber,
          digestCount: initialCount,
          daysToKeep,
          cutoffDate: cutoffDate.toISOString(),
          durationMs: Date.now() - startTime
        }, "No old digests to remove");
      }

      return removedCount;

    } catch (error) {
      logger.error({
        operation: 'digest.cleanup.error',
        err: error,
        phone: phoneNumber,
        daysToKeep,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      }, "Error removing old digests");
      return 0;
    }
  }
}
