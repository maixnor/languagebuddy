import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI, OpenAI, OpenAIClient } from "@langchain/openai";
import { Subscriber } from '../features/subscriber/subscriber.types'; // Updated import
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { logger } from '../config';
// @ts-ignore
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
      // Ensure subscriber is hydrated (Dates are Dates, not strings)
      SubscriberService.getInstance().hydrateSubscriber(subscriber);

      logger.info(`🔧 (${subscriber.connections.phone.slice(-4)}) Initiating conversation with subscriber`);
      setContextVariable('phone', subscriber.connections.phone);

      const currentLocalTime = DateTime.now().setZone(subscriber.profile.timezone || 'UTC');
      const hour = currentLocalTime.hour;
      const timeSinceLastMessageMinutes = await this.getTimeSinceLastMessage(subscriber.connections.phone);

      // Pre-empt LLM response if it's night time for the user AND a new conversation day.
      // This specifically handles the case where the agent might "wake up" to send a digest or scheduled message
      // and it's late for the user, preventing inappropriate "Good morning" messages.
      if ((hour >= 22 || hour < 6) && (timeSinceLastMessageMinutes !== null && timeSinceLastMessageMinutes >= 6 * 60)) {
        logger.info(`🌙 (${subscriber.connections.phone.slice(-4)}) Pre-empting conversation: Night time for user.`);
        return `It's getting late for you (${currentLocalTime.toFormat('hh:mm a')}), ${subscriber.profile.name}. Perhaps we should continue our English practice tomorrow? Have a good night!`;
      }

      let systemPrompt: string;

      if (systemPromptOverride) {
        systemPrompt = systemPromptOverride;
      } else {
        const conversationDurationMinutes = await this.getConversationDuration(subscriber.connections.phone);
        // timeSinceLastMessageMinutes is already calculated above

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

  async processUserMessage(subscriber: Subscriber, humanMessage: string, systemPromptOverride?: string): Promise<string> {
    if (!subscriber) {
        logger.error("Subscriber is required to process user message");
        throw new Error("Subscriber is required to process user message");
    }
    if (!humanMessage) {
        logger.error("Invalid message provided");
        throw new Error("Invalid message provided");
    }

    // Ensure subscriber is hydrated
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
        lastDigestTopic: null, // TODO: Implement fetching last digest topic
      });
    }

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

  async checkLastResponse(subscriber: Subscriber): Promise<string> {
    const phone = subscriber.connections.phone;
    const checkpoint = await this.checkpointer.getCheckpoint(phone);

    if (!checkpoint || !checkpoint.checkpoint || !(checkpoint.checkpoint as any).values?.messages?.length) {
      return "I can't check anything yet because the conversation is empty.";
    }

    const history = (checkpoint.checkpoint as any).values.messages;
    
    // Use a temporary thread ID for the check to avoid polluting main history
    const tempThreadId = `check-${phone}-${Date.now()}`;
    
    const checkSystemPrompt = `You are a strict Quality Assurance auditor for an AI Language Tutor.
Your goal is to find mistakes in the *last* message sent by the 'assistant' in the conversation history.

Check for:
1.  **Hallucinations**: Did the assistant invent facts, places, or events that don't exist? (e.g. "There is a famous Eiffel Tower in Berlin").
2.  **Language Errors**: Did the assistant teach incorrect grammar or vocabulary?
3.  **Consistency**: Does the response contradict previous facts established in the chat?

**Instructions**:
- Analyze the conversation history provided.
- If the last assistant message is correct and helpful, respond with JSON: {"status": "OK"}
- If you find a mistake, respond with JSON: 
  {
    "status": "ERROR", 
    "explanation": "Brief explanation for the user about what was wrong.", 
    "system_correction": "Short instruction for the system to avoid this error in the future."
  }
- Be strict about facts and grammar. Be lenient about style.
- IGNORE mistakes made by the 'user' (Human). Only check the 'assistant'.
- Output ONLY the JSON object.
`;

    try {
      // Construct the message payload
      const messages = [
        new SystemMessage(checkSystemPrompt),
        ...history,
        new HumanMessage("!check_audit_request: Perform the audit on the last assistant response now. Output JSON only.")
      ];

      const result = await this.agent.invoke(
        { messages },
        { configurable: { thread_id: tempThreadId } }
      );
      
      // Cleanup temp thread
      await this.checkpointer.deleteCheckpoint(tempThreadId);
      
      const responseText = result.messages[result.messages.length - 1].content;
      
      // Attempt to parse JSON
      let resultJson: any;
      try {
        // extract json if surrounded by text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          resultJson = JSON.parse(jsonMatch[0]);
        } else {
          logger.warn({ responseText }, "Could not parse JSON from check response");
          return "I couldn't verify the last message automatically. Please try asking me to explain if you are unsure!";
        }
      } catch (e) {
        logger.error({ err: e, responseText }, "JSON parse error in checkLastResponse");
        return "I encountered an error while checking. Please try again.";
      }

      if (resultJson.status === "OK") {
        return "I've checked the last message and it looks correct to me! ✅";
      } else if (resultJson.status === "ERROR") {
        // Apply system correction to main thread
        if (resultJson.system_correction) {
          await this.injectSystemCorrection(phone, resultJson.system_correction);
        }
        return `⚠️ Potential mistake found:\n\n${resultJson.explanation}`;
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

    const newMessages = [
      ...((checkpointTuple.checkpoint as any).values as any).messages,
      new SystemMessage(`[SYSTEM CORRECTION from !check]: ${correction}`)
    ];

    const newCheckpoint = {
      ...checkpointTuple.checkpoint,
      values: {
        ...(checkpointTuple.checkpoint as any).values,
        messages: newMessages
      }
    };
    
    // We need to update the checkpoint. 
    await this.checkpointer.putTuple(
      checkpointTuple.config,
      newCheckpoint,
      checkpointTuple.metadata,
      checkpointTuple.parentConfig
    );
    logger.info({ phone, correction }, "Injected system correction into conversation");
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
      if (checkpoint && (checkpoint.checkpoint as any).values && Array.isArray((checkpoint.checkpoint as any).values.messages) && (checkpoint.checkpoint as any).values.messages.length > 0) {
        const lastMessage = (checkpoint.checkpoint as any).values.messages[(checkpoint.checkpoint as any).values.messages.length - 1];
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
