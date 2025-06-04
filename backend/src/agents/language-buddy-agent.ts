import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ConversationState, Subscriber, SystemPromptEntry } from '../types';
import { logger, config } from '../config';
import { RedisCheckpointSaver } from '../persistence/redis-checkpointer';
import { SubscriberService } from '../services/subscriber-service';
import { updateSubscriberTool, collectFeedbackTool } from '../tools/conversation-tools';

// Define the state schema using Annotation
const ConversationStateAnnotation = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (x: any[], y: any[]) => x.concat(y),
    default: () => [],
  }),
  subscriber: Annotation<Subscriber>({
    reducer: (x: any, y: any) => ({ ...x, ...y }),
    default: () => ({} as Subscriber),
  }),
  shouldEnd: Annotation<boolean>({
    reducer: (x: boolean, y: boolean) => y,
    default: () => false,
  }),
  conversationMode: Annotation<'chatting' | 'tutoring'>({
    reducer: (x: any, y: any) => y,
    default: () => "chatting" as const,
  }),
  isPremium: Annotation<boolean>({
    reducer: (x: boolean, y: boolean) => y,
    default: () => false,
  }),
  sessionStartTime: Annotation<Date>({
    reducer: (x: Date, y: Date) => y,
    default: () => new Date(),
  }),
  lastMessageTime: Annotation<Date | undefined>({
    reducer: (x: Date | undefined, y: Date | undefined) => y,
    default: () => undefined,
  }),
});

export class LanguageBuddyAgent {
  private graph: any;
  private checkpointer: RedisCheckpointSaver;
  private subscriberService: SubscriberService;
  private llm: any;

  constructor(checkpointer: RedisCheckpointSaver) {
    this.checkpointer = checkpointer;
    this.subscriberService = SubscriberService.getInstance();
    
    // Create LLM instance with both tools
    this.llm = new ChatOpenAI({
      modelName: config.openai.model,
      temperature: 0.7,
      maxTokens: config.openai.maxTokens,
    }).bindTools([updateSubscriberTool, collectFeedbackTool]);

    this.graph = this.createGraph();
  }

  private createGraph() {
    const graph = new StateGraph(ConversationStateAnnotation);

    graph
      .addNode("process_conversation", this.processConversation.bind(this))
      .addEdge(START, "process_conversation")
      .addEdge("process_conversation", END);

    return graph.compile({ checkpointer: this.checkpointer });
  }

  private async processConversation(state: ConversationState): Promise<Partial<ConversationState>> {
    try {
      // Get or create subscriber
      let subscriber = await this.subscriberService.getSubscriber(state.subscriber.phone);
      if (!subscriber) {
        subscriber = await this.subscriberService.createSubscriber(state.subscriber.phone);
      }

      // Create system prompt that instructs GPT to handle everything naturally
      const systemPrompt = this.getSystemPrompt(subscriber);
      const messagesWithContext = [
        new SystemMessage(systemPrompt),
        ...state.messages
      ];

      const response = await this.llm.invoke(messagesWithContext.reverse().slice(0, 10));
      
      // Update last active time
      await this.subscriberService.updateSubscriber(subscriber.phone, {
        lastActiveAt: new Date()
      });

      logger.info({ 
        phoneNumber: subscriber.phone, 
        messageLength: response?.content?.length || 0,
        hadToolCalls: response.tool_calls?.length > 0 ? "yes" : "no"
      }, "Message processed");

      return {
        messages: response,
        subscriber,
        isPremium: subscriber.isPremium || false,
        lastMessageTime: new Date(),
      };
    } catch (error) {
      logger.error({ err: error }, "Error processing conversation");
      
      const errorMessage = new AIMessage({
        content: "I'm having some technical difficulties. Please try again!"
      });
      
      return {
        messages: [errorMessage]
      };
    }
  }

  private getSystemPrompt(subscriber: Subscriber): string {
    const missingInfo = this.identifyMissingInfo(subscriber);
    const primary = subscriber.speakingLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';
    const learning = subscriber.learningLanguages?.map(l => `${l.languageName} (${l.level || 'unknown level'})`).join(', ') || 'Not specified';
    
    let prompt = `You are a helpful language learning buddy. Your role is to have natural conversations that help users practice languages.

CURRENT USER INFO:
- Name: ${subscriber.name}
- Speaking languages: ${primary}
- Learning languages: ${learning}

MISSING PROFILE INFO: ${missingInfo.length > 0 ? missingInfo.join(', ') : 'None'}

INSTRUCTIONS:
1. Have natural, friendly conversations in ${primary}
2. When users practice ${learning}, respond appropriately but explain things in ${primary}
3. **PROACTIVELY ask for missing profile information** - don't wait for users to mention it
4. When users share personal info, use the update_subscriber tool to save it immediately
5. When users provide feedback about our conversations, use the collect_feedback tool to save it
6. Be encouraging and adjust difficulty to their level
7. Keep responses conversational and not too long
`;

if (missingInfo && missingInfo.length > 0) {
  prompt += `
  PROACTIVE INFORMATION GATHERING:
  ${this.generateInfoGatheringInstructions(missingInfo)}
  `
}
prompt += 
`
PROFILE UPDATES:
- When users mention their name ("I'm John", "Call me Maria") → update name
- When they mention languages ("I speak French", "I'm learning Spanish") → update languages  
- When they mention their level ("I'm a beginner", "I'm intermediate") → update level
- When they mention location/timezone → update timezone

FEEDBACK COLLECTION:
- When users give feedback about our conversations, teaching quality, or suggestions → use collect_feedback tool
- Examples: "This is helpful", "You explain too fast", "Could you add more examples", "I love these conversations"

WHEN TO REQUEST FEEDBACK:
- If the user seems confused or asks multiple clarifying questions
- If you notice the user is struggling with explanations
- If there are misunderstandings or communication issues
- If the user expresses frustration or difficulty
- If the conversation feels awkward or unnatural
- After explaining something complex that the user might not have understood

When any of these situations occur, naturally ask: "How am I doing? I want to make sure my explanations are helpful - any honest feedback would be great!"

Be natural and conversational. Proactively gather missing information but weave it smoothly into conversation flow.`;
    return prompt;
  }

  private identifyMissingInfo(subscriber: Subscriber): string[] {
    const missing: string[] = [];
    
    if (!subscriber.name || subscriber.name === "New User") {
      missing.push("name");
    }
    
    if (!subscriber.speakingLanguages || subscriber.speakingLanguages.length === 0) {
      missing.push("native/speaking languages");
    }
    
    if (!subscriber.learningLanguages || subscriber.learningLanguages.length === 0) {
      missing.push("learning languages");
    }
    
    subscriber.learningLanguages?.forEach((lang, index) => {
      if (!lang.level) {
        missing.push(`${lang.languageName} level`);
      }
    });
    
    subscriber.speakingLanguages?.forEach((lang, index) => {
      if (!lang.level) {
        missing.push(`${lang.languageName} level`);
      }
    });
    
    if (!subscriber.timezone) {
      missing.push("timezone/location");
    }
    
    return missing;
  }

  private generateInfoGatheringInstructions(missingInfo: string[]): string {
    if (missingInfo.length === 0) {
      return "✅ Profile complete! Focus on natural conversation.";
    }
    
    const instructions: string[] = [];
    
    if (missingInfo.includes("name")) {
      instructions.push("- Ask for their name early in conversation: 'What should I call you?'");
    }
    
    if (missingInfo.includes("native/speaking languages")) {
      instructions.push("- Ask about their native or proficient language(s).");
    }
    
    if (missingInfo.includes("learning languages")) {
      instructions.push("- Ask what language(s) they want to learn.");
    }
    
    if (missingInfo.some(info => info.includes("level"))) {
      instructions.push("- Ask about their language level in the learning language.");
    }
    
    if (missingInfo.includes("timezone/location")) {
      instructions.push("- Ask about approximate location for the time zone");
    }
    
    instructions.push(`
⚠️ PRIORITY: Ask for the most important missing info (${missingInfo.join(', ')}) in the first few messages.
📋 ASK ONE QUESTION AT A TIME - don't overwhelm the user with multiple questions.`);
    
    return instructions.join('\n');
  }

  // Public interface methods
  async initiate(phone: string, systemPrompt: SystemPromptEntry): Promise<string> {
    try {
      let subscriber = await this.subscriberService.getSubscriber(phone);
      if (!subscriber) {
        subscriber = await this.subscriberService.createSubscriber(phone);
      }

      const initialState: ConversationState = {
        messages: [],
        subscriber,
        conversationMode: "chatting",
        isPremium: subscriber.isPremium || false,
        sessionStartTime: new Date(),
        lastMessageTime: undefined,
      };

      const result = await this.graph.invoke(initialState, {
        configurable: { thread_id: phone }
      });

      return result.messages || systemPrompt.firstUserMessage;
    } catch (error) {
      logger.error({ err: error, phone }, "Error in initiate method");
      return systemPrompt.firstUserMessage || "Hello! I'm your language buddy. What language would you like to practice today?";
    }
  }

  async initiateConversation(phone: string, systemPrompt: SystemPromptEntry): Promise<string> {
    return this.initiate(phone, systemPrompt);
  }

  async processUserMessage(phone: string, messageText: string): Promise<string> {
    try {
      const subscriber = await this.subscriberService.getSubscriber(phone);
      if (!subscriber) {
        throw new Error("Subscriber not found");
      }

      const userMessage = new HumanMessage(messageText);
      const conversationState: ConversationState = {
        messages: [userMessage],
        subscriber,
        conversationMode: "chatting",
        isPremium: subscriber.isPremium || false,
        sessionStartTime: new Date(),
        lastMessageTime: subscriber.lastActiveAt,
      };

      const result = await this.graph.invoke(conversationState, {
        configurable: { thread_id: phone }
      });

      // Extract the AI response message and get its content
      const responseMessage = result.messages?.pop();
      if (responseMessage && responseMessage.content) {
        return responseMessage.content;
      }
      
      logger.warn(result);
      return "I'm not sure how to respond to that. Could you try rephrasing?";
    } catch (error) {
      logger.error({ err: error, phone, messageText }, "Error processing user message");
      return "I'm experiencing some technical difficulties. Please try again in a moment!";
    }
  }
}