import OpenAI from "openai";
import pino from 'pino';
import { SystemPromptEntry } from "./main"; // Assuming SystemPromptEntry will be exported from main.ts or a shared types file

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
  if (messages.length === 0 || messages[0].role !== 'system') {
    logger.warn("getGPTResponse called with messages array not starting with a system prompt. Adding a default one.");
    messages.unshift({ role: "system", content: currentDefaultSystemPrompt.prompt });
  }

  const filteredMessages = messages.filter(msg => msg.content && String(msg.content).trim() !== '');
  if (filteredMessages.length === 1 && filteredMessages[0].role === 'system') {
    logger.warn("getGPTResponse called with only a system message. Adding a default user message.");
    messages.push({ role: "user", content: currentDefaultSystemPrompt.firstUserMessage });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: filteredMessages,
    });
    return completion.choices[0].message;
  } catch (error) {
    logger.error({ err: error }, "Error getting GPT response.");
    return null;
  }
}
