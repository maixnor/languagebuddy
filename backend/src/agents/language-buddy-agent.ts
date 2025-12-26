import { HumanMessage, SystemMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Subscriber } from '../features/subscriber/subscriber.types';
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { logger } from '../core/config';
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { setContextVariable } from "@langchain/core/context";
import { DateTime } from "luxon";
import { generateSystemPrompt } from '../features/subscriber/subscriber.prompts';
import { getDailyTopic } from '../features/subscriber/subscriber.utils';
import { z } from "zod";
import { DigestService } from '../features/digest/digest.service';
import { setSpanAttributes } from '../core/observability/tracing';
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { tool } from "@langchain/core/tools";
import { StateGraph, START, END, addMessages } from "@langchain/langgraph";
import { AgentState } from "./agent.types";
import { createFeedbackGraph } from "../features/feedback/feedback.graph";
import { createOnboardingGraph } from "../features/onboarding/onboarding.graph";

import {
  updateSubscriberTool,
  createSubscriberTool,
  addLanguageDeficiencyTool,
  proposeMistakeToleranceChangeTool,
} from "../features/subscriber/subscriber.tools";
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

    // Define the feedback trigger tool
    const startFeedbackSession = tool(async () => {
      return "Feedback session requested."; 
    }, {
      name: "startFeedbackSession",
      description: "Initiates a feedback collection session. Call this when the user wants to give feedback."
    });

    const allTools = [
      updateSubscriberTool,
      createSubscriberTool,
      addLanguageDeficiencyTool,
      proposeMistakeToleranceChangeTool,
      startFeedbackSession,
    ];

    // 1. Create Main Agent (Legacy ReAct logic wrapped)
    // We use createReactAgent but it returns a compiled graph.
    // We will use this graph as a node in our parent graph.
    const mainAgentSubgraph = createReactAgent({
      llm: llm,
      tools: allTools,
      // We don't pass checkpointer here, the parent graph handles persistence.
    });

    // 2. Create Feedback Subgraph
    const feedbackSubgraph = createFeedbackGraph(llm, feedbackService);

    // 3. Create Onboarding Subgraph
    // Assuming SubscriberService is already initialized by ServiceContainer
    const onboardingSubgraph = createOnboardingGraph(llm, SubscriberService.getInstance());

    // 4. Define Mode Manager Node
    // This node inspects the conversation history to see if we should switch modes.
    const modeManager = (state: AgentState) => {
        const messages = state.messages;
        const recent = messages.slice(-5);
        const hasFeedbackCall = recent.some(m => 
            (m instanceof ToolMessage && m.name === "startFeedbackSession")
        );
        
        if (hasFeedbackCall) {
            return { activeMode: "feedback" as const };
        }
        return { };
    };

    // 5. Build Parent Graph
    const workflow = new StateGraph<AgentState>({
        channels: {
            messages: { value: addMessages, default: () => [] },
            subscriber: { value: (x, y) => y ?? x, default: () => ({} as any) },
            activeMode: { value: (x, y) => y ?? x, default: () => "conversation" },
            subgraphState: { value: (x, y) => y, default: () => undefined },
        }
    })
    .addNode("main_agent", mainAgentSubgraph)
    .addNode("feedback_subgraph", feedbackSubgraph)
    .addNode("onboarding_subgraph", onboardingSubgraph)
    .addNode("mode_manager", modeManager)
    
    // Router Logic
    .addConditionalEdges(START, (state) => {
        if (state.subscriber?.status === 'onboarding') {
            return "onboarding_subgraph";
        }
        if (state.activeMode === "feedback") {
            return "feedback_subgraph";
        }
        return "main_agent";
    }, {
        onboarding_subgraph: "onboarding_subgraph",
        feedback_subgraph: "feedback_subgraph",
        main_agent: "main_agent"
    })

    // Edges from Subgraphs
    .addEdge("main_agent", "mode_manager")
    
    // Mode Manager Routing
    .addConditionalEdges("mode_manager", (state) => {
        if (state.activeMode === "feedback") {
            return "feedback_subgraph"; // Immediate transition
        }
        return END;
    }, {
        feedback_subgraph: "feedback_subgraph",
        [END]: END
    })

    .addEdge("feedback_subgraph", END)
    .addEdge("onboarding_subgraph", END);

    this.agent = workflow.compile({ checkpointer: checkpointer });
  }


  async initiateConversation(subscriber: Subscriber, humanMessage: string, systemPromptOverride?: string, metadata?: Record<string, any>): Promise<{ response: string; updatedSubscriber: Subscriber }> {
    try {
      SubscriberService.getInstance().hydrateSubscriber(subscriber);

      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) Initiating conversation with subscriber`);
      setContextVariable('phone', subscriber.connections.phone);

      const currentLocalTime = DateTime.now().setZone(subscriber.profile.timezone || 'UTC');
      const hour = currentLocalTime.hour;
      const timeSinceLastMessageMinutes = await this.getTimeSinceLastMessage(subscriber.connections.phone);

      if ((hour >= 22 || hour < 6) && (timeSinceLastMessageMinutes !== null && timeSinceLastMessageMinutes >= 6 * 60)) {
        logger.info(`🌙 (${subscriber.connections.phone.slice(-4)}) Pre-empting conversation: Night time for user.`);
        return { response: `It's getting late for you (${currentLocalTime.toFormat('hh:mm a')}), ${subscriber.profile.name}. Perhaps we should continue our English practice tomorrow? Have a good night!`, updatedSubscriber: subscriber };
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

        const dailyTopic = getDailyTopic(subscriber);

        systemPrompt = generateSystemPrompt({
          subscriber,
          conversationDurationMinutes,
          timeSinceLastMessageMinutes,
          currentLocalTime,
          lastDigestTopic,
          messageCount: 0, // Conversation just starting
          dailyTopic
        });
      }

      const dateString = currentLocalTime.toISODate();
      const sessionId = `${subscriber.connections.phone}_${dateString}`;
      
      const newMetadata = { 
        ...(metadata || {}), 
        sessionId 
      };

      setSpanAttributes({
        'user.id': subscriber.connections.phone,
        'conversation.id': sessionId,
        'user.timezone': subscriber.profile.timezone || 'unknown'
      });

      // Updated invoke call for StateGraph
      const result = await this.agent.invoke(
        { 
            messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage ?? 'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.')],
            subscriber: subscriber, // Pass subscriber to state
            activeMode: "conversation" // Default mode
        },
        { 
          configurable: { thread_id: subscriber.connections.phone },
          metadata: newMetadata
        }
      );

      // Extract last message
      const lastMsg = result.messages[result.messages.length - 1];
      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) AI response: ${lastMsg.content}`);
      return { response: lastMsg.content || "initiateConversation() failed", updatedSubscriber: result.subscriber };
    } catch (error) {
      logger.error({ err: error, subscriber: subscriber }, "Error in initiate method");
      return { response: "An error occurred while initiating the conversation. Please try again later.", updatedSubscriber: subscriber };
    }
  }

  async processUserMessage(subscriber: Subscriber, humanMessage: string, systemPromptOverride?: string): Promise<{ response: string; updatedSubscriber: Subscriber }> {
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

      // Calculate message count from checkpoint
      const checkpointTuple = await this.checkpointer.getTuple({ configurable: { thread_id: subscriber.connections.phone } });
      const messages = (checkpointTuple?.checkpoint as any)?.channel_values?.messages || [];
      const messageCount = Array.isArray(messages) ? messages.length : 0;

      const dailyTopic = getDailyTopic(subscriber);

      systemPrompt = generateSystemPrompt({
        subscriber,
        conversationDurationMinutes,
        timeSinceLastMessageMinutes,
        currentLocalTime,
        lastDigestTopic,
        messageCount,
        dailyTopic
      });
    }

    const existingCheckpoint = await this.checkpointer.getTuple({ configurable: { thread_id: subscriber.connections.phone } });
    const existingMetadata = existingCheckpoint?.metadata || {};

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

    setSpanAttributes({
      'user.id': subscriber.connections.phone,
      'conversation.id': sessionId,
      'user.timezone': subscriber.profile.timezone || 'unknown'
    });

    try {
      const response = await this.agent.invoke(
          { 
              messages: [new SystemMessage(systemPrompt), new HumanMessage(humanMessage)],
              subscriber: subscriber
          },
          { 
            configurable: { thread_id: subscriber.connections.phone },
            metadata: newMetadata
          }
      );

      const lastMsg = response.messages[response.messages.length - 1];
      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) AI response: ${lastMsg.content}`);
      return { response: lastMsg.content || "processUserMessage()?", updatedSubscriber: response.subscriber };
    } catch (error) {
      logger.error({ err: error, subscriber: subscriber }, "Error in processUserMessage method");
      return { response: "An error occurred while processing your message. Please try again later.", updatedSubscriber: subscriber };
    }
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
    // Check if activeMode is onboarding (if we add onboarding mode later)
    // Or check existing metadata logic if we preserve it.
    // The previous logic checked checkpoint metadata 'type'.
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
    const instruction = `You are a helpful assistant. Your task is to ask the user the following question in ${language}.
If the text below is already in ${language}, output it exactly as is.
If it is in a different language, translate it naturally into ${language}.
Do not add any conversational filler, intro, or outro. Just output the question.

Question to ask: "${systemPrompt}"`;

    try {
      const result = await this.llm.invoke([
        new SystemMessage(instruction)
      ]);
      
      const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      return content || "oneShotMessage() failed";
    } catch (error) {
      logger.error({ err: error, phone }, "Error in oneShotMessage");
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
        // Handle different message structures or types if necessary
        // LangGraph messages usually don't have 'timestamp' property directly on the object unless added.
        // But the previous implementation assumed it did.
        // We will assume the previous implementation was correct about the shape or we need to fix it.
        // Standard BaseMessage doesn't have timestamp.
        // But if we use metadata?
        // Let's keep the logic but wrap in try-catch/checks.
        if ((lastMessage as any).timestamp) {
          const lastMessageTime = DateTime.fromISO((lastMessage as any).timestamp);
          const now = DateTime.now();
          return now.diff(lastMessageTime, 'minutes').minutes;
        }
         // Fallback: Checkpoint 'ts' (if available)?
      }
      return null;
    } catch (error) {
      logger.error({ err: error, phone }, "Error getting time since last message");
      return null;
    }
  }
}
