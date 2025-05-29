import OpenAI from "openai";
import pino from "pino";

export interface SystemPromptEntry {
  slug: string;
  prompt: string;
  firstUserMessage: string;
}

export interface Language {
  languageName: string;
  level: string;
  currentObjectives: string[];
}

export interface Subscriber {
  phone: string;
  name: string; // how the user wants to be adressed
  speakingLanguages: Language[];
  learningLanguages: Language[];
  messageHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

