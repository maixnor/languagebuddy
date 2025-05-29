import { exit } from "node:process";
import { handleGptCommands } from "./commands";
import pino from 'pino';
import OpenAI from "openai";

interface Language {
  languageName: string;
  level: string;
  currentObjectives: string[];
}

// Data structures for group tours
export interface Subscriber {
  phone: string;
  name: string; // how the user wants to be adressed
  speakingLanguages: Language[];
  learningLanguages: Language[];
  messageHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

const logger = pino({});

const subscriber: Subscriber = {
    phone: "436801231233", 
    name: "",
    speakingLanguages: [],
    learningLanguages: [],
    messageHistory: []
}

const message = "!COMMAND {'name':'Herbert'}\n this is the message"

const ok = handleGptCommands(message, subscriber)
logger.info(ok);

if (subscriber.name !== "Herbert") exit(1);
