import { Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Subscriber } from '../types';
import { logger } from '../config';
import {createReactAgent} from "@langchain/langgraph/prebuilt";
import {setContextVariable} from "@langchain/core/context";
import {RedisCheckpointSaver} from "../persistence/redis-checkpointer";
import {tools} from "../tools";

export class LanguageBuddyAgent {
  private checkpointer: RedisCheckpointSaver;
  private agent: any;

  constructor(checkpointer: RedisCheckpointSaver) {
    this.checkpointer = checkpointer;

    // Create LLM instance with both tools
    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 1000,
    });

    this.agent = createReactAgent({
      llm: llm,
      tools: tools,
      checkpointer: checkpointer,
    })
  }
  async initiateConversation(subscriber: Subscriber, systemPrompt: string, humanMessage: string): Promise<string> {
    try {
      const result = await this.agent.invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage ?? 'The Conversation is not buing initializaed by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.')] },
        { configurable: { thread_id: subscriber.phone }}
      );

      return result.messages[result.messages.length - 1].text || "initiateConversation() failed";
    } catch (error) {
      logger.error({ err: error, subscriber: subscriber }, "Error in initiate method");
      return "An error occurred while initiating the conversation. Please try again later.";
    }
  }

  async processUserMessage(subscriber: Subscriber, humanMessage: string): Promise<string> {
    if (!subscriber) {
        logger.error("Subscriber is required to process user message");
        throw new Error("Subscriber is required to process user message");
    }
    if (!humanMessage) {
        logger.error("Invalid message provided");
        throw new Error("Invalid message provided");
    }

    logger.info(`🔧 (${subscriber.phone.slice(-4)}) Processing user message:`, humanMessage);

    setContextVariable('phone', subscriber.phone);
    const response = await this.agent.invoke(
        { messages: [new HumanMessage(humanMessage)] },
        { configurable: { thread_id: subscriber.phone } }
    );

    logger.info(`🔧 (${subscriber.phone.slice(-4)}) AI response:`, response.messages[response.messages.length - 1].text);
    return response.messages.pop().text || "processUserMessage()?";
  }

  async clearConversation(phone: string): Promise<void> {
    try {
      await this.checkpointer.clearUserHistory(phone);
      logger.info({ phone }, "Conversation cleared successfully");
    } catch (error) {
      logger.error({ err: error, phone }, "Error clearing conversation");
    }
  }

  async currentlyInActiveConversation(userPhone: string) {
    try {
      const checkpoint = await this.checkpointer.getCheckpoint(userPhone);
      if (!checkpoint) {
        logger.info({ phone: userPhone }, "No active conversation found");
        return false;
      }
      return true;
    } catch (error) {
      logger.error({ err: error, phone: userPhone }, "Error checking active conversation status");
      return false;
    }
  }
}