import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI, OpenAI, OpenAIClient } from "@langchain/openai";
import { Subscriber } from '../features/subscriber/subscriber.types'; // Updated import
import { logger } from '../config';
import {createReactAgent} from "@langchain/langgraph/prebuilt";
import {setContextVariable} from "@langchain/core/context";
import { RedisCheckpointSaver } from "../persistence/redis-checkpointer";
import { DateTime } from "luxon";
import { generateSystemPrompt } from "../util/system-prompts";
// import {tools} from "../tools"; // Original tools import - will need re-evaluation

// Manually import the individual tools for now, until a better tool registration strategy is in place
import {
  updateSubscriberTool,
  createSubscriberTool,
  addLanguageDeficiencyTool,
  proposeMistakeToleranceChangeTool,
  initializeSubscriberTools // Also needed if the agent directly calls this
} from "../features/subscriber/subscriber.tools";
import { feedbackTools } from "../tools/feedback-tools"; // Keep original feedback tools for now

export class LanguageBuddyAgent {
  private checkpointer: RedisCheckpointSaver;
  private agent: any;

  constructor(checkpointer: RedisCheckpointSaver, llm: ChatOpenAI) {
    this.checkpointer = checkpointer;

    // Combine all tools, including the newly moved subscriber tools
    const allTools = [
      updateSubscriberTool,
      createSubscriberTool,
      addLanguageDeficiencyTool,
      proposeMistakeToleranceChangeTool,
      ...feedbackTools, // Existing feedback tools
      // ... any other tools that will be migrated later
    ];

    this.agent = createReactAgent({
      llm: llm,
      tools: allTools, // Use the combined tools
      checkpointer: checkpointer,
    })
  }
  async initiateConversation(subscriber: Subscriber, humanMessage: string, systemPromptOverride?: string): Promise<string> {
    try {
      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) Initiating conversation with subscriber`);
      setContextVariable('phone', subscriber.connections.phone);

      let systemPrompt: string;

      if (systemPromptOverride) {
        systemPrompt = systemPromptOverride;
      } else {
        const conversationDurationMinutes = await this.getConversationDuration(subscriber.connections.phone);
        const timeSinceLastMessageMinutes = await this.getTimeSinceLastMessage(subscriber.connections.phone);
        const currentLocalTime = DateTime.now().setZone(subscriber.profile.timezone || 'UTC');

        systemPrompt = generateSystemPrompt({
          subscriber,
          conversationDurationMinutes,
          timeSinceLastMessageMinutes,
          currentLocalTime,
          lastDigestTopic: null, // TODO: Implement fetching last digest topic
        });
      }

      const result = await this.agent.invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage ?? 'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.')] },
        { configurable: { thread_id: subscriber.connections.phone }}
      );

      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) AI response: ${result.messages[result.messages.length - 1].content}`);
      return result.messages[result.messages.length - 1].content || "initiateConversation() failed";
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

    logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) Processing user message: ${humanMessage}`);

    setContextVariable('phone', subscriber.connections.phone);

    const conversationDurationMinutes = await this.getConversationDuration(subscriber.connections.phone);
    const timeSinceLastMessageMinutes = await this.getTimeSinceLastMessage(subscriber.connections.phone);
    const currentLocalTime = DateTime.now().setZone(subscriber.profile.timezone || 'UTC');

    const systemPrompt = generateSystemPrompt({
      subscriber,
      conversationDurationMinutes,
      timeSinceLastMessageMinutes,
      currentLocalTime,
      lastDigestTopic: null, // TODO: Implement fetching last digest topic
    });

    const response = await this.agent.invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage)] },
        { configurable: { thread_id: subscriber.connections.phone } }
    );

    logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) AI response: ${response.messages[response.messages.length - 1].content}`);
    return response.messages[response.messages.length - 1].content || "processUserMessage()?";
  }

  async clearConversation(phone: string): Promise<void> {
    try {
      logger.info({ phone }, "Starting conversation clearance");
      await this.checkpointer.clearUserHistory(phone);
      logger.info({ phone }, "Conversation clearance completed");
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

  // TODO don't save oneShotMessages to the normal conversational thread
  async oneShotMessage(systemPrompt: string, language: string, phone: string): Promise<string> {
    // Compose a system prompt that instructs the LLM to respond in the target language
    const prompt = `${systemPrompt}\nONLY RESPOND IN THE LANGUAGE ${language}.`;
    try {
      const result = await this.agent.invoke(
        { messages: [new SystemMessage(prompt)] },
        { configurable: { thread_id: phone } }
      );
      return result.messages[result.messages.length - 1].text || "oneShotMessage() failed";
    } catch (error) {
      logger.error({ err: error }, "Error in oneShotMessage");
      return "An error occurred while generating the message.";
    }
  }

  async getConversationDuration(phone: string): Promise<number | null> {
    try {
      const checkpoint = await this.checkpointer.getCheckpoint(phone);
      if (checkpoint && checkpoint.metadata?.conversationStartedAt) {
        const startedAt = DateTime.fromISO(checkpoint.metadata.conversationStartedAt);
        const now = DateTime.now();
        return now.diff(startedAt, 'minutes').minutes;
      }
      return null;
    } catch (error) {
      logger.error({ err: error, phone }, "Error getting conversation duration");
      return null;
    }
  }

  async getTimeSinceLastMessage(phone: string): Promise<number | null> {
    try {
      const checkpoint = await this.checkpointer.getCheckpoint(phone);
      if (checkpoint && checkpoint.checkpoint.values && Array.isArray(checkpoint.checkpoint.values.messages) && checkpoint.checkpoint.values.messages.length > 0) {
        const lastMessage = checkpoint.checkpoint.values.messages[checkpoint.checkpoint.values.messages.length - 1];
        if (lastMessage.timestamp) {
          const lastMessageTime = DateTime.fromISO(lastMessage.timestamp);
          const now = DateTime.now();
          return now.diff(lastMessageTime, 'minutes').minutes;
        }
      }
      return null;
    } catch (error) {
      logger.error({ err: error, phone }, "Error getting time since last message");
      return null;
    }
  }
}
