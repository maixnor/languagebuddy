import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ConversationState, Subscriber, SystemPromptEntry } from '../types';
import { logger, config } from '../config';
import { RedisCheckpointSaver } from '../persistence/redis-checkpointer';
import { SubscriberService } from '../services/subscriber-service';
import { collectFeedbackTool } from '../tools/feedback-tools';
import {createReactAgent} from "@langchain/langgraph/prebuilt";
import {FeedbackService} from "../services/feedback-service";
import {updateSubscriberTool} from "../tools/subscriber-tools";
import {setContextVariable} from "@langchain/core/context";

// Define the state schema using Annotation
export const ConversationStateAnnotation = Annotation.Root({
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
  conversationMode: Annotation<'chatting' | 'tutoring' | 'roleplaying'>({
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
  private checkpointer: RedisCheckpointSaver;
  private subscriberService: SubscriberService;
  private feedbackService: FeedbackService;
  private agent: any;

  constructor(checkpointer: RedisCheckpointSaver) {
    this.checkpointer = checkpointer;
    this.subscriberService = SubscriberService.getInstance();
    this.feedbackService = FeedbackService.getInstance();

    // Create LLM instance with both tools
    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 1000,
    });

    this.agent = createReactAgent({
      llm: llm,
      tools: [updateSubscriberTool, collectFeedbackTool],
      checkpointer: checkpointer,
    })
  }
  async initiate(phone: string, systemPrompt: SystemPromptEntry): Promise<string> {
    try {
      let subscriber = await this.subscriberService.getSubscriber(phone);
      if (!subscriber) {
        subscriber = await this.subscriberService.createSubscriber(phone);
      }

      const initialState: ConversationState = {
        messages: [new SystemMessage(systemPrompt.prompt), new HumanMessage(systemPrompt.firstUserMessage)],
        subscriber,
        conversationMode: "chatting",
        isPremium: subscriber.isPremium || false,
        sessionStartTime: new Date(),
        lastMessageTime: undefined,
      };

      const result = await this.agent.invoke(
        { messages: initialState.messages },
        { configurable: { thread_id: phone }}
      );

      return result.messages || systemPrompt.firstUserMessage;
    } catch (error) {
      logger.error({ err: error, phone }, "Error in initiate method");
      return systemPrompt.firstUserMessage || "Hello! I'm your language buddy. What language would you like to practice today?";
    }
  }

  async initiateConversation(phone: string, systemPrompt: SystemPromptEntry): Promise<string> {
    return this.initiate(phone, systemPrompt);
  }

  async processUserMessage(state: ConversationState): Promise<ConversationState> {
    try {
      setContextVariable('phone', state.subscriber.phone);
      const result = await this.agent.invoke(
          { messages: state.messages },
          { configurable: { thread_id: state.subscriber.phone }}
      );

      // update subscriber if there are changes
      const subscriber = await this.subscriberService.getSubscriber(state.subscriber.phone);
      if (subscriber && subscriber !== state.subscriber) {
        state.subscriber = subscriber;
      }
      logger.warn(result);
      state.messages.push(result.messages);
      return state;
    } catch (error) {
      logger.error({ err: error, phone: state.subscriber.phone, lastMessage: state.messages.pop().text }, "Error processing user message");
      return state;
    }
  }
}