import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger, trackEvent, trackMetric } from '../config';
import { Subscriber, FeedbackEntry, VocabularyItem, ConversationDigest } from '../types';
import { SubscriberService } from '../services/subscriber-service';
import { FeedbackService } from '../services/feedback-service';

// New tool to detect missing subscriber information
export const detectMissingInfoTool = tool(
  async ({ subscriber }: { subscriber: Subscriber }) => {
    try {
      const missingFields: string[] = [];
      const suggestions: string[] = [];

      // Determine primary language for asking questions
      const primaryLanguage = determinePrimaryLanguageFromSubscriber(subscriber);

      // Check for missing basic information - be more selective about name
      const hasValidName = subscriber.name && 
                          subscriber.name !== "New User" && 
                          subscriber.name.trim().length > 0;
      
      if (!hasValidName) {
        missingFields.push("name");
        suggestions.push(getLocalizedQuestion("name", primaryLanguage));
      }

      if (!subscriber.speakingLanguages || subscriber.speakingLanguages.length === 0) {
        missingFields.push("speakingLanguages");
        suggestions.push(getLocalizedQuestion("speakingLanguages", primaryLanguage));
      }

      if (!subscriber.learningLanguages || subscriber.learningLanguages.length === 0) {
        missingFields.push("learningLanguages");
        suggestions.push(getLocalizedQuestion("learningLanguages", primaryLanguage));
      }

      // Only ask for timezone if user has basic info but missing this optional field
      if (hasValidName && (subscriber.learningLanguages?.length || 0) > 0 && !subscriber.timezone) {
        missingFields.push("timezone");
        suggestions.push(getLocalizedQuestion("timezone", primaryLanguage));
      }

      // Check for incomplete language information only if they have languages defined
      subscriber.learningLanguages?.forEach((lang, index) => {
        if (!lang.level) {
          missingFields.push(`learningLanguages[${index}].level`);
          suggestions.push(getLocalizedQuestion("learningLevel", primaryLanguage, lang.languageName));
        }
        if (!lang.currentObjectives || lang.currentObjectives.length === 0) {
          missingFields.push(`learningLanguages[${index}].currentObjectives`);
          suggestions.push(getLocalizedQuestion("learningGoals", primaryLanguage, lang.languageName));
        }
      });

      subscriber.speakingLanguages?.forEach((lang, index) => {
        if (!lang.level) {
          missingFields.push(`speakingLanguages[${index}].level`);
          suggestions.push(getLocalizedQuestion("speakingLevel", primaryLanguage, lang.languageName));
        }
      });

      return {
        hasMissingInfo: missingFields.length > 0,
        missingFields,
        suggestions,
        nextQuestionToAsk: suggestions[0] || null
      };
    } catch (error) {
      logger.error({ err: error }, "Error detecting missing subscriber info");
      return {
        hasMissingInfo: false,
        missingFields: [],
        suggestions: [],
        nextQuestionToAsk: null
      };
    }
  },
  {
    name: "detect_missing_info",
    description: "Detect missing information in a subscriber's profile and suggest questions to fill gaps",
    schema: z.object({
      subscriber: z.object({
        phone: z.string(),
        name: z.string(),
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
        isPremium: z.boolean().optional(),
        lastActiveAt: z.date().optional()
      })
    }),
  }
);

// Enhanced update subscriber tool with better validation and parsing
export const updateSubscriberTool = tool(
  async ({ updates, phoneNumber, extractFromMessage }: { 
    updates?: Partial<Subscriber>, 
    phoneNumber: string,
    extractFromMessage?: string
  }) => {
    try {
      const subscriberService = SubscriberService.getInstance();
      let finalUpdates = updates || {};

      // If extractFromMessage is provided, try to parse information from user's message
      if (extractFromMessage) {
        const extractedInfo = await extractInfoFromMessage(extractFromMessage);
        finalUpdates = { ...finalUpdates, ...extractedInfo };
      }

      if (Object.keys(finalUpdates).length === 0) {
        return "No information to update";
      }

      await subscriberService.updateSubscriber(phoneNumber, finalUpdates);
      
      logger.info({ phoneNumber, updates: finalUpdates }, "Subscriber information updated via enhanced tool");
      
      // Return a summary of what was updated
      const updatedFields = Object.keys(finalUpdates);
      return `Successfully updated: ${updatedFields.join(', ')}. Information saved to your profile!`;
    } catch (error) {
      logger.error({ err: error, phoneNumber, updates }, "Error updating subscriber");
      return "I had trouble saving that information. Could you try again?";
    }
  },
  {
    name: "update_subscriber",
    description: "Update subscriber language learning information and profile data, optionally extracting info from a message",
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
      }).optional(),
      extractFromMessage: z.string().optional(),
    }),
  }
);

// Tool to intelligently parse and update subscriber info from natural language
export const smartUpdateSubscriberTool = tool(
  async ({ userMessage, phoneNumber, currentSubscriber }: {
    userMessage: string,
    phoneNumber: string,
    currentSubscriber: Subscriber
  }) => {
    try {
      const updates = await parseSubscriberInfoFromMessage(userMessage, currentSubscriber);
      
      if (Object.keys(updates).length === 0) {
        return "No profile information detected in your message.";
      }

      const subscriberService = SubscriberService.getInstance();
      await subscriberService.updateSubscriber(phoneNumber, updates);
      
      logger.info({ phoneNumber, updates }, "Smart subscriber update completed");
      
      const updateSummary = generateUpdateSummary(updates);
      return `Got it! I've updated your profile: ${updateSummary}`;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error in smart subscriber update");
      return "I couldn't parse that information. Could you be more specific?";
    }
  },
  {
    name: "smart_update_subscriber",
    description: "Intelligently parse user messages to extract and update subscriber profile information",
    schema: z.object({
      userMessage: z.string(),
      phoneNumber: z.string(),
      currentSubscriber: z.object({
        phone: z.string(),
        name: z.string(),
        speakingLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string().optional(),
          currentObjectives: z.array(z.string()).optional()
        })),
        learningLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string().optional(),
          currentObjectives: z.array(z.string()).optional()
        })),
        timezone: z.string().optional(),
        isPremium: z.boolean().optional()
      })
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

// Helper functions for parsing subscriber information from messages
async function extractInfoFromMessage(message: string): Promise<Partial<Subscriber>> {
  const updates: Partial<Subscriber> = {};
  const lowerMessage = message.toLowerCase();

  // Extract name
  const namePatterns = [
    /(?:my name is|i'm|i am|call me)\s+([a-zA-Z]+)/i,
    /(?:name:|name is)\s+([a-zA-Z]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = message.match(pattern);
    if (match) {
      updates.name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
      break;
    }
  }

  // Extract timezone
  const timezonePatterns = [
    /(?:timezone|time zone|tz)[:is\s]+([A-Za-z_\/]+)/i,
    /(?:i'm in|located in|live in)\s+([A-Za-z_\/\s]+)/i
  ];
  
  for (const pattern of timezonePatterns) {
    const match = message.match(pattern);
    if (match) {
      updates.timezone = match[1].trim();
      break;
    }
  }

  return updates;
}

async function parseSubscriberInfoFromMessage(message: string, currentSubscriber: Subscriber): Promise<Partial<Subscriber>> {
  const updates: Partial<Subscriber> = {};

  // Extract learning languages
  const learningMatches = message.match(/(?:learning|studying|want to learn|practicing)\s+(spanish|french|german|italian|portuguese|chinese|japanese|korean|arabic|russian|english|dutch|swedish|norwegian|danish)/gi);
  if (learningMatches) {
    const learningLanguages = learningMatches.map(match => {
      const lang = match.split(/\s+/).pop()?.toLowerCase();
      return {
        languageName: lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : '',
        level: extractLevelFromMessage(message, lang || ''),
        currentObjectives: extractObjectivesFromMessage(message)
      };
    }).filter(lang => lang.languageName);

    updates.learningLanguages = [...(currentSubscriber.learningLanguages || []), ...learningLanguages];
  }

  // Extract speaking languages
  const speakingMatches = message.match(/(?:i speak|i know|fluent in|native)\s+(spanish|french|german|italian|portuguese|chinese|japanese|korean|arabic|russian|english|dutch|swedish|norwegian|danish)/gi);
  if (speakingMatches) {
    const speakingLanguages = speakingMatches.map(match => {
      const lang = match.split(/\s+/).pop()?.toLowerCase();
      return {
        languageName: lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : '',
        level: extractLevelFromMessage(message, lang || '') || 'native',
        currentObjectives: []
      };
    }).filter(lang => lang.languageName);

    updates.speakingLanguages = [...(currentSubscriber.speakingLanguages || []), ...speakingLanguages];
  }

  // Extract basic info using existing function
  const basicInfo = await extractInfoFromMessage(message);
  Object.assign(updates, basicInfo);

  return updates;
}

function extractLevelFromMessage(message: string, language: string): string {
  const lowerMessage = message.toLowerCase();
  
  // Look for level indicators around the language mention
  const levelPatterns = [
    /beginner|beginning|just started|new to/i,
    /intermediate|middle|okay|decent/i,
    /advanced|fluent|proficient|expert/i,
    /native|mother tongue|first language/i
  ];

  const levels = ['beginner', 'intermediate', 'advanced', 'native'];
  
  for (let i = 0; i < levelPatterns.length; i++) {
    if (levelPatterns[i].test(lowerMessage)) {
      return levels[i];
    }
  }

  return 'beginner'; // default
}

function extractObjectivesFromMessage(message: string): string[] {
  const objectives: string[] = [];
  const lowerMessage = message.toLowerCase();

  // Common learning objectives
  const objectivePatterns = [
    { pattern: /conversation|speaking|talk/i, objective: 'conversational fluency' },
    { pattern: /business|work|professional/i, objective: 'business communication' },
    { pattern: /travel|vacation|trip/i, objective: 'travel communication' },
    { pattern: /grammar|structure/i, objective: 'grammar mastery' },
    { pattern: /vocabulary|words/i, objective: 'vocabulary expansion' },
    { pattern: /pronunciation|accent/i, objective: 'pronunciation improvement' },
    { pattern: /writing|text/i, objective: 'writing skills' },
    { pattern: /reading|books/i, objective: 'reading comprehension' }
  ];

  for (const { pattern, objective } of objectivePatterns) {
    if (pattern.test(lowerMessage)) {
      objectives.push(objective);
    }
  }

  return objectives.length > 0 ? objectives : ['general language practice'];
}

function generateUpdateSummary(updates: Partial<Subscriber>): string {
  const summaryParts: string[] = [];

  if (updates.name) {
    summaryParts.push(`name set to ${updates.name}`);
  }

  if (updates.learningLanguages && updates.learningLanguages.length > 0) {
    const langs = updates.learningLanguages.map(l => l.languageName).join(', ');
    summaryParts.push(`learning ${langs}`);
  }

  if (updates.speakingLanguages && updates.speakingLanguages.length > 0) {
    const langs = updates.speakingLanguages.map(l => l.languageName).join(', ');
    summaryParts.push(`speaking ${langs}`);
  }

  if (updates.timezone) {
    summaryParts.push(`timezone set to ${updates.timezone}`);
  }

  return summaryParts.join(', ');
}

// Placeholder functions for language detection and localized question retrieval
function determinePrimaryLanguageFromSubscriber(subscriber: Subscriber): string {
  // For now, default to English if no languages are set
  if (!subscriber.speakingLanguages || subscriber.speakingLanguages.length === 0) {
    return 'english';
  }

  // Prefer speaking language if available
  const primarySpeaking = subscriber.speakingLanguages[0].languageName.toLowerCase();
  if (primarySpeaking) {
    return primarySpeaking;
  }

  // Fallback to learning language if no speaking language is set
  const primaryLearning = subscriber.learningLanguages?.[0]?.languageName.toLowerCase();
  return primaryLearning || 'english';
}

function getLocalizedQuestion(field: string, language: string, param?: string): string {
  const questions: Record<string, Record<string, string>> = {
    name: {
      english: "What should I call you?",
      spanish: "¿Cómo debería llamarte?",
      french: "Comment devrais-je t'appeler?",
      german: "Wie soll ich dich nennen?",
      italian: "Come dovrei chiamarti?",
      portuguese: "Como devo te chamar?",
      chinese: "我应该怎么称呼你？",
      japanese: "あなたを何と呼べばいいですか？",
      korean: "당신을 뭐라고 불러야 하나요?",
      arabic: "ماذا يجب أن أسميك؟",
      russian: "Как мне тебя называть?",
      dutch: "Hoe moet ik je noemen?",
      swedish: "Vad ska jag kalla dig?",
      norwegian: "Hva skal jeg kalle deg?",
      danish: "Hvad skal jeg kalde dig?"
    },
    speakingLanguages: {
      english: "What languages do you speak fluently?",
      spanish: "¿Qué idiomas hablas con fluidez?",
      french: "Quelles langues parles-tu couramment?",
      german: "Welche Sprachen sprichst du fließend?",
      italian: "Quali lingue parli fluentemente?",
      portuguese: "Quais idiomas você fala fluentemente?",
      chinese: "你流利地说什么语言？",
      japanese: "あなたは何語を流暢に話しますか？",
      korean: "당신은 어떤 언어를 유창하게 말하나요?",
      arabic: "ما هي اللغات التي تتحدثها بطلاقة؟",
      russian: "На каких языках вы говорите свободно?",
      dutch: "Welke talen spreek je vloeiend?",
      swedish: "Vilka språk talar du flytande?",
      norwegian: "Hvilke språk snakker du flytende?",
      danish: "Hvilke sprog taler du flydende?"
    },
    learningLanguages: {
      english: "What language would you like to learn or practice?",
      spanish: "¿Qué idioma te gustaría aprender o practicar?",
      french: "Quelle langue aimerais-tu apprendre ou pratiquer?",
      german: "Welche Sprache möchtest du lernen oder üben?",
      italian: "Quale lingua ti piacerebbe imparare o praticare?",
      portuguese: "Que língua você gostaria de aprender ou praticar?",
      chinese: "你想学或练习什么语言？",
      japanese: "どの言語を学びたいですか？",
      korean: "어떤 언어를 배우고 싶나요?",
      arabic: "ما هي اللغة التي تود تعلمها أو ممارستها؟",
      russian: "Какой язык вы хотели бы выучить или практиковать?",
      dutch: "Welke taal zou je willen leren of oefenen?",
      swedish: "Vilket språk skulle du vilja lära dig eller öva?",
      norwegian: "Hvilket språk ønsker du å lære eller øve på?",
      danish: "H hvilket sprog vil du gerne lære eller øve?"
    },
    timezone: {
      english: "What timezone are you in? (e.g., America/New_York, Europe/Berlin)",
      spanish: "¿En qué zona horaria te encuentras? (por ejemplo, America/New_York, Europe/Berlín)",
      french: "Dans quel fuseau horaire es-tu ? (par exemple, America/New_York, Europe/Berlin)",
      german: "In welcher Zeitzone befindest du dich? (z.B. America/New_York, Europe/Berlin)",
      italian: "In quale fuso orario ti trovi? (ad esempio, America/New_York, Europe/Berlino)",
      portuguese: "Em que fuso horário você está? (por exemplo, America/New_York, Europe/Berlin)",
      chinese: "你在哪个时区？（例如，America/New_York，Europe/Berlin）",
      japanese: "あなたはどのタイムゾーンにいますか？（例：America/New_York、Europe/Berlin）",
      korean: "당신은 어떤 표준시를 사용하고 있나요? (예: America/New_York, Europe/Berlin)",
      arabic: "في أي منطقة زمنية أنت؟ (على سبيل المثال، America/New_York، Europe/Berlin)",
      russian: "В каком часовом поясе вы находитесь? (например, America/New_York, Europe/Berlin)",
      dutch: "In welke tijdzone bevind je je? (bijv. America/New_York, Europe/Berlin)",
      swedish: "I vilken tidszon befinner du dig? (t.ex. America/New_York, Europe/Berlin)",
      norwegian: "Hvilket tidssone er du i? (f.eks. America/New_York, Europe/Berlin)",
      danish: "Hvilken tidszone er du i? (f.eks. America/New_York, Europe/Berlin)"
    },
    learningLevel: {
      english: "What's your current level in {{language}}? (beginner, intermediate, advanced)",
      spanish: "¿Cuál es tu nivel actual en {{language}}? (principiante, intermedio, avanzado)",
      french: "Quel est ton niveau actuel en {{language}}? (débutant, intermédiaire, avancé)",
      german: "Wie ist dein aktuelles Niveau in {{language}}? (Anfänger, Fortgeschrittener, Profi)",
      italian: "Qual è il tuo attuale livello in {{language}}? (principiante, intermedio, avanzato)",
      portuguese: "Qual é o seu nível atual em {{language}}? (iniciante, intermediário, avançado)",
      chinese: "你在{{language}}的当前水平是什么？（初学者，中级，高级）",
      japanese: "あなたの{{language}}の現在のレベルは何ですか？（初級、中級、上級）",
      korean: "당신의 {{language}} 현재 수준은 무엇인가요? (초급, 중급, 고급)",
      arabic: "ما هو مستواك الحالي في {{language}}؟ (مبتدئ، متوسط، متقدم)",
      russian: "Какой у вас текущий уровень в {{language}}? (начальный, средний, продвинутый)",
      dutch: "Wat is je huidige niveau in {{language}}? (beginner, gemiddeld, gevorderd)",
      swedish: "Vad är din nuvarande nivå i {{language}}? (nybörjare, mellanliggande, avancerad)",
      norwegian: "Hva er ditt nåværende nivå i {{language}}? (nybegynner, middels, avansert)",
      danish: "Hvad er dit nuværende niveau i {{language}}? (begynder, mellem, avanceret)"
    },
    learningGoals: {
      english: "What are your learning goals for {{language}}?",
      spanish: "¿Cuáles son tus objetivos de aprendizaje para {{language}}?",
      french: "Quels sont tes objectifs d'apprentissage pour {{language}}?",
      german: "Was sind deine Lernziele für {{language}}?",
      italian: "Quali sono i tuoi obiettivi di apprendimento per {{language}}?",
      portuguese: "Quais são seus objetivos de aprendizagem para {{language}}?",
      chinese: "你对{{language}}的学习目标是什么？",
      japanese: "あなたの{{language}}の学習目標は何ですか？",
      korean: "당신의 {{language}} 학습 목표는 무엇인가요?",
      arabic: "ما هي أهدافك التعليمية لـ {{language}}؟",
      russian: "Каковы ваши учебные цели для {{language}}?",
      dutch: "Wat zijn je leerdoelen voor {{language}}?",
      swedish: "Vad är dina lärandemål för {{language}}?",
      norwegian: "Hva er læringsmålene dine for {{language}}?",
      danish: "Hvad er dine læringsmål for {{language}}?"
    },
    speakingLevel: {
      english: "What's your proficiency level in {{language}}?",
      spanish: "¿Cuál es tu nivel de competencia en {{language}}?",
      french: "Quel est ton niveau de compétence en {{language}}?",
      german: "Wie ist dein Kenntnisstand in {{language}}?",
      italian: "Qual è il tuo livello di competenza in {{language}}?",
      portuguese: "Qual é o seu nível de proficiência em {{language}}?",
      chinese: "你在{{language}}的熟练程度如何？",
      japanese: "あなたの{{language}}の熟練度はどれくらいですか？",
      korean: "당신의 {{language}} 숙련도는 어느 정도인가요?",
      arabic: "ما هو مستوى إتقانك لـ {{language}}؟",
      russian: "Каков ваш уровень владения {{language}}?",
      dutch: "Wat is je vaardigheidsniveau in {{language}}?",
      swedish: "Vad är din färdighetsnivå i {{language}}?",
      norwegian: "Hva er ferdighetsnivået ditt i {{language}}?",
      danish: "Hvad er dit færdighedsniveau i {{language}}?"
    }
  };

  const question = questions[field]?.[language];
  if (question) {
    return param ? question.replace('{{language}}', param) : question;
  }

  // Fallback to English if no translation is available
  return questions[field]?.['english'] || '';
}