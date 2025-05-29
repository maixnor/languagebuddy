import OpenAI from "openai";
import pino from 'pino';
import { SystemPromptEntry } from "./types";

let openai: OpenAI;
let logger: pino.Logger;
let currentDefaultSystemPrompt: SystemPromptEntry;

export function initOpenAI(apiKey: string, pinoLogger: pino.Logger, defaultSystemPrompt: SystemPromptEntry) {
  if (!apiKey) {
    pinoLogger.error("OPENAI_API_KEY is not set. OpenAI integration will be disabled.");
    // Potentially throw an error or handle this case as per application requirements
    return;
  }
  openai = new OpenAI({ apiKey });
  logger = pinoLogger;
  currentDefaultSystemPrompt = defaultSystemPrompt;
  logger.info("OpenAI initialized.");
}

export async function getGPTResponse(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<OpenAI.Chat.Completions.ChatCompletionMessage | null> {
  if (!openai) {
    logger.error("OpenAI client not initialized.");
    return null;
  }

  let effectiveMessages = [...messages]; // Work on a copy

  if (effectiveMessages.length === 0 || effectiveMessages[0].role !== 'system') {
    logger.warn("getGPTResponse called with messages array not starting with a system prompt. Adding a default one.");
    effectiveMessages.unshift({ role: "system", content: currentDefaultSystemPrompt.prompt });
  }

  // Filter out messages with empty or whitespace-only content AFTER ensuring system prompt.
  let filteredMessages = effectiveMessages.filter(msg => msg.content && String(msg.content).trim() !== '');

  // If, after filtering, only a system message remains, add the default first user message.
  if (filteredMessages.length === 1 && filteredMessages[0].role === 'system') {
    logger.warn("getGPTResponse called with only a system message (after filtering). Adding default user message.");
    filteredMessages.push({ role: "user", content: currentDefaultSystemPrompt.firstUserMessage });
  }

  if (filteredMessages.length === 0) {
      logger.error("No valid messages to send to GPT after filtering.");
      return null;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: filteredMessages, // Use the potentially modified filteredMessages
    });
    return completion.choices[0].message;
  } catch (error) {
    logger.error({ err: error }, "Error getting GPT response.");
    return null;
  }
}
