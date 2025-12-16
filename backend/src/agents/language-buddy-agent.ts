import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Subscriber } from '../features/subscriber/subscriber.types';
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { logger } from '../core/config';
// @ts-ignore
import {createReactAgent} from "@langchain/langgraph/prebuilt";
import {setContextVariable} from "@langchain/core/context";
import { DateTime } from "luxon";
import { generateSystemPrompt } from '../features/subscriber/subscriber.prompts';
import { z } from "zod";
import { DigestService } from '../features/digest/digest.service';
import { setSpanAttributes } from '../core/observability/tracing';
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import {
  updateSubscriberTool,
  createSubscriberTool,
  addLanguageDeficiencyTool,
  proposeMistakeToleranceChangeTool,
} from "../features/subscriber/subscriber.tools";
import { getFeedbackTools } from "../tools/feedback-tools";
import { checkLastResponse } from "./agent.check";

import { FeedbackService } from '../features/feedback/feedback.service';

export class LanguageBuddyAgent {
  private checkpointer: BaseCheckpointSaver;
  private agent: any;
  private llm: ChatOpenAI;
  private digestService: DigestService;
  private feedbackService: FeedbackService;

  constructor(checkpointer: BaseCheckpointSaver, llm: ChatOpenAI, digestService: DigestService, feedbackService: FeedbackService) {
    this.checkpointer = checkpointer;
    this.llm = llm;
    this.digestService = digestService;
    this.feedbackService = feedbackService;

    const allTools = [
      updateSubscriberTool,
      createSubscriberTool,
      addLanguageDeficiencyTool,
      proposeMistakeToleranceChangeTool,
      ...getFeedbackTools(this.feedbackService),
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
        
        let lastDigestTopic = null;
        if (this.digestService) {
          try {
            const latestDigest = await this.digestService.getRecentDigests(subscriber.connections.phone, 1);
            lastDigestTopic = latestDigest.length > 0 ? latestDigest[0].topic : null;
          } catch (error) {
            logger.error({ err: error, phone: subscriber.connections.phone }, "Error fetching recent digests in initiateConversation");
          }
        } else {
            logger.error("DigestService is missing in initiateConversation. Skipping digest retrieval.");
        }

        systemPrompt = generateSystemPrompt({
          subscriber,
          conversationDurationMinutes,
          timeSinceLastMessageMinutes,
          currentLocalTime,
          lastDigestTopic,
        });
      }

      // Session ID Logic for Tracing
      const dateString = currentLocalTime.toISODate(); // YYYY-MM-DD in user's timezone
      const sessionId = `${subscriber.connections.phone}_${dateString}`;
      
      const newMetadata = { 
        ...(metadata || {}), 
        sessionId 
      };

      // Set Trace Attributes
      setSpanAttributes({
        'user.id': subscriber.connections.phone,
        'conversation.id': sessionId,
        'user.timezone': subscriber.profile.timezone || 'unknown'
      });

      const result = await this.agent.invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage ?? 'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.')] },
        { 
          configurable: { thread_id: subscriber.connections.phone },
          metadata: newMetadata
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
      
      let lastDigestTopic = null;
      if (this.digestService) {
        try {
          const latestDigest = await this.digestService.getRecentDigests(subscriber.connections.phone, 1);
          lastDigestTopic = latestDigest.length > 0 ? latestDigest[0].topic : null;
        } catch (error) {
          logger.error({ err: error, phone: subscriber.connections.phone }, "Error fetching recent digests in processUserMessage");
        }
      } else {
          logger.error("DigestService is missing in processUserMessage. Skipping digest retrieval.");
      }

      systemPrompt = generateSystemPrompt({
        subscriber,
        conversationDurationMinutes,
        timeSinceLastMessageMinutes,
        currentLocalTime,
        lastDigestTopic,
      });
    }

    const existingCheckpoint = await this.checkpointer.getTuple({ configurable: { thread_id: subscriber.connections.phone } });
    const existingMetadata = existingCheckpoint?.metadata || {};

    // Session ID Logic for Tracing
    let sessionId = (existingMetadata as any)?.sessionId;

    if (!sessionId) {
      const currentLocalTime = DateTime.now().setZone(subscriber.profile.timezone || 'UTC');
      const dateString = currentLocalTime.toISODate();
      sessionId = `${subscriber.connections.phone}_${dateString}`;
    }

    const newMetadata = {
      ...existingMetadata,
      sessionId
    };

    // Set Trace Attributes
    setSpanAttributes({
      'user.id': subscriber.connections.phone,
      'conversation.id': sessionId,
      'user.timezone': subscriber.profile.timezone || 'unknown'
    });

    const response = await this.agent.invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage)] },
        { 
          configurable: { thread_id: subscriber.connections.phone },
          metadata: newMetadata
        }
    );

    logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) AI response: ${response.messages[response.messages.length - 1].content}`);
    return response.messages[response.messages.length - 1].content || "processUserMessage()?";
  }

  async clearConversation(phone: string): Promise<void> {
    try {
      logger.info({ phone }, "Starting conversation clearance");
      await this.checkpointer.deleteThread(phone);
      logger.info({ phone }, "Conversation clearance completed");
    } catch (error) {
      logger.error({ err: error, phone }, "Error clearing conversation");
    }
  }

  async checkLastResponse(subscriber: Subscriber): Promise<string> {
    return checkLastResponse(subscriber, this.llm, this.checkpointer);
  }

  async isOnboardingConversation(phone: string): Promise<boolean> {
    const checkpointTuple = await this.checkpointer.getTuple({ configurable: { thread_id: phone } });
    if (!checkpointTuple) return false;
    return (checkpointTuple.metadata as any)?.type === 'onboarding';
  }

  async currentlyInActiveConversation(userPhone: string) {
    try {
      const checkpoint = await this.checkpointer.getTuple({ configurable: { thread_id: userPhone } });
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
      const checkpoint = await this.checkpointer.getTuple({ configurable: { thread_id: phone } });
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
      const checkpoint = await this.checkpointer.getTuple({ configurable: { thread_id: phone } });
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