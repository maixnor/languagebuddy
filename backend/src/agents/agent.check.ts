import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Subscriber } from '../features/subscriber/subscriber.types';
import { logger } from '../core/config';
import { z } from "zod";


const AuditResultSchema = z.object({
  status: z.enum(["OK", "ERROR"]).describe("The result of the audit. 'OK' if the last assistant message is correct, 'ERROR' if a mistake was found."),
  user_response: z.string().describe("The message to send to the user in the language of the conversation. If OK, confirm the specific topic is correct (e.g. 'Yes, the use of past tense here is perfect!'). If ERROR, explain the mistake."),
  system_correction: z.string().nullable().describe("Short instruction for the system to avoid this error in the future (if ERROR). If no error, set to null."),
});

export async function checkLastResponse(
  subscriber: Subscriber,
  llm: ChatOpenAI,
  checkpointer: any
): Promise<string> {
    const phone = subscriber.connections.phone;
    const checkpointTuple = await checkpointer.get({ configurable: { thread_id: phone } });
    const checkpoint = checkpointTuple?.checkpoint;

    const messages = (checkpoint as any)?.values?.messages ||
                     (checkpoint as any)?.channel_values?.messages;

    if (!checkpoint || !messages?.length) {
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

      const structuredLlm = (llm as any).withStructuredOutput(AuditResultSchema);
      const result = await structuredLlm.invoke(messagesWithPrompt);

      if (result.status === "OK") {
        return `${result.user_response} ✅`;
      } else if (result.status === "ERROR") {
        if (result.system_correction) {
          await injectSystemCorrection(phone, result.system_correction, checkpointer);
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

async function injectSystemCorrection(phone: string, correction: string, checkpointer: any): Promise<void> {
    const checkpointTuple = await checkpointer.get({ configurable: { thread_id: phone } });
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
    
    await checkpointer.put(
      checkpointTuple.config,
      newCheckpoint,
      checkpointTuple.metadata,
      undefined // Added newVersions argument to satisfy BaseCheckpointSaver interface
    );
    logger.info({ phone, correction }, "Injected system correction into conversation");
}
