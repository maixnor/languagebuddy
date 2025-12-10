import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Subscriber } from '../features/subscriber/subscriber.types';
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { logger } from '../config';
// @ts-ignore
import {createReactAgent} from "@langchain/langgraph/prebuilt";
import {setContextVariable} from "@langchain/core/context";
import { RedisCheckpointSaver } from "../persistence/redis-checkpointer";
import { DateTime } from "luxon";
import { generateSystemPrompt } from '../features/subscriber/subscriber.prompts';
import { z } from "zod";

import {
  updateSubscriberTool,
  createSubscriberTool,
  addLanguageDeficiencyTool,
  proposeMistakeToleranceChangeTool,
} from "../features/subscriber/subscriber.tools";
import { feedbackTools } from "../tools/feedback-tools";

const AuditResultSchema = z.object({
  status: z.enum(["OK", "ERROR"]).describe("The result of the audit. 'OK' if the last assistant message is correct, 'ERROR' if a mistake was found."),
  user_response: z.string().describe("The message to send to the user in the language of the conversation. If OK, confirm the specific topic is correct (e.g. 'Yes, the use of past tense here is perfect!'). If ERROR, explain the mistake."),
  system_correction: z.string().optional().describe("Short instruction for the system to avoid this error in the future (if ERROR)."),
});

export class LanguageBuddyAgent {
  private checkpointer: RedisCheckpointSaver;
  private agent: any;
  private llm: ChatOpenAI;

  constructor(checkpointer: RedisCheckpointSaver, llm: ChatOpenAI) {
    this.checkpointer = checkpointer;
    this.llm = llm;

    const allTools = [
      updateSubscriberTool,
      createSubscriberTool,
      addLanguageDeficiencyTool,
      proposeMistakeToleranceChangeTool,
      ...feedbackTools,
    ];

    this.agent = createReactAgent({
      llm: llm,
      tools: allTools,
      checkpointer: checkpointer,
    })
  }

  async initiateConversation(subscriber: Subscriber, humanMessage: string, systemPromptOverride?: string, metadata?: Record<string, any>): Promise<string> {
    try {
      SubscriberService.getInstance().hydrateSubscriber(subscriber);

      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) Initiating conversation with subscriber`);
      setContextVariable('phone', subscriber.connections.phone);

      const currentLocalTime = DateTime.now().setZone(subscriber.profile.timezone || 'UTC');
      const hour = currentLocalTime.hour;
      const timeSinceLastMessageMinutes = await this.getTimeSinceLastMessage(subscriber.connections.phone);

      if ((hour >= 22 || hour < 6) && (timeSinceLastMessageMinutes !== null && timeSinceLastMessageMinutes >= 6 * 60)) {
        logger.info(`🌙 (${subscriber.connections.phone.slice(-4)}) Pre-empting conversation: Night time for user.`);
        return `It's getting late for you (${currentLocalTime.toFormat('hh:mm a')}), ${subscriber.profile.name}. Perhaps we should continue our English practice tomorrow? Have a good night!`;
      }

      let systemPrompt: string;

      if (systemPromptOverride) {
        systemPrompt = systemPromptOverride;
      } else {
        const conversationDurationMinutes = await this.getConversationDuration(subscriber.connections.phone);
        systemPrompt = generateSystemPrompt({
          subscriber,
          conversationDurationMinutes,
          timeSinceLastMessageMinutes,
          currentLocalTime,
          lastDigestTopic: null,
        });
      }

      const result = await this.agent.invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage ?? 'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.')] },
        { 
          configurable: { thread_id: subscriber.connections.phone },
          metadata: metadata || {}
        }
      );

      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) AI response: ${result.messages[result.messages.length - 1].content}`);
      return result.messages[result.messages.length - 1].content || "initiateConversation() failed";
    } catch (error) {
      logger.error({ err: error, subscriber: subscriber }, "Error in initiate method");
      return "An error occurred while initiating the conversation. Please try again later.";
    }
  }

  async processUserMessage(subscriber: Subscriber, humanMessage: string, systemPromptOverride?: string): Promise<string> {
    if (!subscriber) {
        logger.error("Subscriber is required to process user message");
        throw new Error("Subscriber is required to process user message");
    }
    if (!humanMessage) {
        logger.error("Invalid message provided");
        throw new Error("Invalid message provided");
    }

    SubscriberService.getInstance().hydrateSubscriber(subscriber);

    logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) Processing user message: ${humanMessage}`);

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
        lastDigestTopic: null,
      });
    }

    const existingCheckpoint = await this.checkpointer.getCheckpoint(subscriber.connections.phone);
    const existingMetadata = existingCheckpoint?.metadata || {};

    const response = await this.agent.invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage)] },
        { 
          configurable: { thread_id: subscriber.connections.phone },
          metadata: existingMetadata
        }
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

  async checkLastResponse(subscriber: Subscriber): Promise<string> {
    const phone = subscriber.connections.phone;
    const checkpoint = await this.checkpointer.getCheckpoint(phone);

    const messages = (checkpoint?.checkpoint as any)?.values?.messages || 
                     (checkpoint?.checkpoint as any)?.channel_values?.messages;

    if (!checkpoint || !checkpoint.checkpoint || !messages?.length) {
      return "I can't check anything yet because the conversation is empty.";
    }

    const history = messages;

    const checkSystemPrompt = `You are a strict Quality Assurance auditor for an AI Language Tutor.
Your goal is to find mistakes in the *last* messages sent by the 'assistant' in the conversation history.

Check for:
1.  **Hallucinations**: Did the assistant invent facts, places, or events that don't exist?
2.  **Language Errors**: Did the assistant teach incorrect grammar or vocabulary?
3.  **Consistency**: Does the response contradict previous facts established in the chat?

**Instructions**:
- Analyze the conversation history provided.
- If the last assistant message is correct and helpful:
  - Set 'status' to "OK".
  - Set 'user_response' to a friendly confirmation in the language of the conversation (e.g., "The conditionals look correct, good job!").
- If you find a mistake:
  - Set 'status' to "ERROR".
  - Set 'user_response' to an explanation of the error in the language of the conversation.
  - Set 'system_correction' to a short instruction for the system.
- Be strict about facts and grammar. Be lenient about style.
- IGNORE mistakes made by the 'user' (Human). Only check the 'assistant'.
`;

    try {
      const messagesWithPrompt = [
        new SystemMessage(checkSystemPrompt),
        ...history,
        new HumanMessage("Perform the audit on the last assistant response now.")
      ];

      const structuredLlm = (this.llm as any).withStructuredOutput(AuditResultSchema);
      const result = await structuredLlm.invoke(messagesWithPrompt);

      if (result.status === "OK") {
        return `${result.user_response} ✅`;
      } else if (result.status === "ERROR") {
        if (result.system_correction) {
          await this.injectSystemCorrection(phone, result.system_correction);
        }
        return `⚠️ ${result.user_response}`;
      } else {
        return "I completed the check but the result was inconclusive.";
      }

    } catch (error) {
      logger.error({ err: error, phone }, "Error in checkLastResponse");
      return "An error occurred while performing the check.";
    }
  }

  private async injectSystemCorrection(phone: string, correction: string): Promise<void> {
    const checkpointTuple = await this.checkpointer.getCheckpoint(phone);
    if (!checkpointTuple) return;

    const checkpoint = checkpointTuple.checkpoint as any;
    const values = checkpoint.values || checkpoint.channel_values;

    if (!values || !values.messages) {
      logger.warn({ phone }, "Could not find messages in checkpoint to inject system correction");
      return;
    }

    const newMessages = [
      ...values.messages,
      new SystemMessage(`[SYSTEM CORRECTION from !check]: ${correction}`)
    ];

    const newCheckpoint = {
      ...checkpoint,
    };

    if (checkpoint.values) {
        newCheckpoint.values = {
            ...checkpoint.values,
            messages: newMessages
        };
    } else {
        newCheckpoint.channel_values = {
            ...checkpoint.channel_values,
            messages: newMessages
        };
    }
    
    await this.checkpointer.putTuple(
      checkpointTuple.config,
      newCheckpoint,
      checkpointTuple.metadata,
      checkpointTuple.parentConfig
    );
    logger.info({ phone, correction }, "Injected system correction into conversation");
  }

  async isOnboardingConversation(phone: string): Promise<boolean> {
    const checkpointTuple = await this.checkpointer.getCheckpoint(phone);
    if (!checkpointTuple) return false;
    return (checkpointTuple.metadata as any)?.type === 'onboarding';
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

  async oneShotMessage(systemPrompt: string, language: string, phone: string): Promise<string> {
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
      if (checkpoint && (checkpoint.metadata as any)?.conversationStartedAt) {
        const startedAt = DateTime.fromISO((checkpoint.metadata as any).conversationStartedAt);
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
      if (!checkpoint) return null;

      const messages = (checkpoint.checkpoint as any).values?.messages || 
                       (checkpoint.checkpoint as any).channel_values?.messages;

      if (messages && Array.isArray(messages) && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
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