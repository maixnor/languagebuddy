import express from "express";
import serveStatic from "serve-static";
import dotenv from "dotenv";
import pino from 'pino';

import "whatsapp-cloud-api-express";
import { readFileSync } from 'fs';
import path from 'path';
const yaml = require('js-yaml');

import { initStripe, checkStripeSubscription } from './stripe';
import { initOpenAI, getGPTResponse } from './gpt';
import { initWhatsApp, sendWhatsAppMessage, markMessageAsRead } from './whatsapp';
import OpenAI from "openai";

dotenv.config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty', // Makes logs human-readable during development
    options: {
      colorize: true
    }
  }
});

const openAiToken = process.env.OPENAI_API_KEY;
const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const whatsappVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

// In-memory store for single-user conversation histories
const conversationHistories: { [key: string]: OpenAI.Chat.Completions.ChatCompletionMessageParam[] } = {};

export interface SystemPromptEntry {
  slug: string;
  prompt: string;
  firstUserMessage: string;
}

let systemPrompts: SystemPromptEntry[] = [];
let defaultSystemPrompt: SystemPromptEntry;
let fallbackSystemPrompt = {
  slug: "default",
  prompt: "You are a helpful language buddy trying his best to match the users language level but are always pushing the user to be slightly out of the comfort zone.",
  firstUserMessage: "Hi! Please ask me what language I want to learn with you and at what level I am."
};

try {
  const promptsPath = path.join(process.cwd(), 'system_prompts.yml');
  const promptsData = readFileSync(promptsPath, 'utf8');
  systemPrompts = yaml.load(promptsData);
  defaultSystemPrompt = systemPrompts.find(prompt => prompt.slug === 'default') || fallbackSystemPrompt;
  logger.info(`Loaded ${systemPrompts.length} system prompts from file`);
} catch (error) {
  logger.error({ err: error }, 'Error loading system prompts from file:');
  defaultSystemPrompt = fallbackSystemPrompt;
  systemPrompts = [defaultSystemPrompt];
}

initStripe(stripeSecretKey!, logger);
if (openAiToken && defaultSystemPrompt) {
  initOpenAI(openAiToken, logger, defaultSystemPrompt);
} else {
  logger.error("OpenAI token or default system prompt is missing. GPT functionality will be impaired.");
}
initWhatsApp(whatsappToken!, whatsappPhoneId!, logger);


interface Language {
  languageName: string;
  level: string;
  currentObjectives: string[];
}

// Data structures for group tours
interface Subscriber {
  phone: string;
  speakingLanguages: Language[];
  learningLanguages: Language[];
  messageHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

const subscribers: Subscriber[] = [];

async function handleUserCommand(messageText: string, subscriber: Subscriber): Promise<boolean> {
  const commandParts = messageText.trim().split(" ");
  const mainCommand = commandParts[0].toLowerCase();

  if (mainCommand === "!help") {
    const helpText = "Available commands:\n" +
                     "!help - Show this help message\n" +
                     "!define <word> - Get definition of a word\n" +
                     "!myinfo - Show your current language profile";
    await sendWhatsAppMessage(subscriber.phone, helpText); // Uses imported sendWhatsAppMessage
    return true;
  } else if (mainCommand === "!define" && commandParts.length > 1) {
    const termToDefine = commandParts.slice(1).join(" ");
    try {
      const definitionPrompt = `Define the term "${termToDefine}" concisely for a language learner.`;
      const tempMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: "You are a helpful dictionary." },
        { role: "user", content: definitionPrompt }
      ];
      const definitionResponse = await getGPTResponse(tempMessages);
      if (definitionResponse?.content) {
        await sendWhatsAppMessage(subscriber.phone, `Definition of "${termToDefine}":\n${definitionResponse.content}`); // Uses imported sendWhatsAppMessage
      } else {
        await sendWhatsAppMessage(subscriber.phone, `Sorry, I couldn\'t define "${termToDefine}" at the moment.`); // Uses imported sendWhatsAppMessage
      }
    } catch (error) {
      logger.error({ err: error, term: termToDefine }, `Error defining term "${termToDefine}":`);
      await sendWhatsAppMessage(subscriber.phone, "Sorry, there was an error getting the definition."); // Uses imported sendWhatsAppMessage
    }
    return true;
  } else if (mainCommand === "!myinfo") {
    let infoText = `Your Language Profile:\n`;
    infoText += `Speaking Languages: ${subscriber.speakingLanguages.length > 0 ? subscriber.speakingLanguages.join(', ') : 'None set'}\n`;
    infoText += "Learning Languages:\n";
    if (subscriber.learningLanguages.length > 0) {
      subscriber.learningLanguages.forEach(lang => {
        infoText += `  - ${lang.languageName}: Level ${lang.level} (Objectives: ${lang.currentObjectives.join(', ') || 'None'})\n`;
      });
    } else {
      infoText += "  None set\n";
    }
    await sendWhatsAppMessage(subscriber.phone, infoText); // Uses imported sendWhatsAppMessage
    return true;
  }

  return false; // Not a recognized command
}

export const app = express();

app.use(express.json());

async function initiateConversation(subscriber: Subscriber, systemPrompt: SystemPromptEntry): Promise<boolean> {
  logger.info({ phone: subscriber.phone, promptSlug: systemPrompt.slug }, `Initiating single-user conversation with system prompt: "${systemPrompt.prompt}" and first user message: "${systemPrompt.firstUserMessage}"`);
  
  conversationHistories[subscriber.phone] = [
    { role: "system", content: systemPrompt.prompt },
    { role: "user", content: systemPrompt.firstUserMessage }
  ];

  try {
    const initialGptResponse = await getGPTResponse(conversationHistories[subscriber.phone]); // Uses imported getGPTResponse

    if (initialGptResponse?.content) {
      // Add AI's first response to history
      conversationHistories[subscriber.phone].push({ role: "assistant", content: initialGptResponse.content });
      return await sendWhatsAppMessage(subscriber.phone, initialGptResponse.content); // Uses imported sendWhatsAppMessage
    } else {
      logger.error({ phone: subscriber.phone, prompt: systemPrompt.prompt, firstUserMessage: systemPrompt.firstUserMessage }, `GPT did not generate an initial message for system prompt`);
      return false;
    }
  } catch (error) {
    logger.error({ err: error, phone: subscriber.phone }, `Error during conversation initiation`);
    return false;
  }
}

// sendWhatsAppMessage function moved to whatsapp.ts

app.post("/initiate", async (req: any, res: any) => {
  const { phone, promptSlug } = req.body;

  if (!phone || !promptSlug) {
    return res.status(400).send("Missing 'phone' or 'promptSlug' in request body.");
  }

  const hasPaid = await checkStripeSubscription(phone); // Uses imported checkStripeSubscription
  if (!hasPaid) {
    logger.info({ phone }, "/initiate: User has not paid according to Stripe.");
    // You might want to send a WhatsApp message here if you have a way to do it before full subscription
    // For now, just return an error.
    //return res.status(403).send("Payment required to initiate conversation. Please subscribe via [your-payment-link].");
  } else {
    logger.info({ phone }, "/initiate: User has paid. Proceeding with initiation.");
  }

  let subscriber = subscribers.find(p => p.phone === phone);
  if (!subscriber) {
    subscriber = {
      phone: phone,
      speakingLanguages: [],
      learningLanguages: [],
      messageHistory: []
    };
    subscribers.push(subscriber); // Add to subscribers list if new and paid
  }

  const selectedPrompt = systemPrompts.find(p => p.slug === promptSlug) || defaultSystemPrompt;

  try {
    const success = await initiateConversation(subscriber, selectedPrompt);
    if (success) {
      res.status(200).send("Conversation initiated successfully.");
    } else {
      res.status(500).send("Failed to initiate conversation.");
    }
  } catch (error) {
    logger.error({ err: error }, "Error in /initiate endpoint after prompt loading");
    res.status(500).send("Internal server error while processing prompts.");
  }
});

app.post("/webhook", async (req: any, res: any) => {
  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];

  if (message?.type === "text") {
    const userPhone = message.from;
    let subscriber = subscribers.find(p => p.phone === userPhone);

    await markMessageAsRead(message.id); // Uses imported markMessageAsRead

    if (!subscriber) {
      logger.info({ userPhone }, "New user messaging. Checking Stripe status.");
      const hasPaid = await checkStripeSubscription(userPhone);

      if (!hasPaid) {
        logger.info({ userPhone }, "User has not paid. Sending payment link.");
        await sendWhatsAppMessage(userPhone, "Welcome! To use this service, please complete your subscription here: [Your Payment Link]"); // Uses imported sendWhatsAppMessage
        return res.sendStatus(200); // Stop processing until payment
      }
      
      logger.info({ userPhone }, "New user has paid. Creating profile.");
      subscriber = {
        phone: userPhone,
        speakingLanguages: [],
        learningLanguages: [],
        messageHistory: [] // This history is part of Subscriber, separate from conversationHistories
      };
      subscribers.push(subscriber);
      // For a new, paid user, initiate the conversation immediately.
      // The current message that triggered this will be ignored for conversation history,
      // as the bot will start with its own initiation message.
      await initiateConversation(subscriber, defaultSystemPrompt);
      return res.sendStatus(200); // Conversation initiated, no further processing of this incoming message.
    }

    // Existing subscriber, or new subscriber for whom conversation was just initiated.
    // Handle user commands first
    if (await handleUserCommand(message.text.body, subscriber)) {
      return res.sendStatus(200); // Command was handled, stop further processing for this message
    }

    // If not a user command, and no conversation history, initiate one.
    // This case should be less common now that new paid users have conversation initiated above.
    if (!conversationHistories[userPhone]) {
      logger.warn({ userPhone }, `No conversation history for subscriber. Initiating with default start.`);
      await initiateConversation(subscriber, defaultSystemPrompt);
      // The current message triggered the initiation. User will reply to the bot's first message.
      return res.sendStatus(200);
    }

    // Process regular conversation message
    try {
      conversationHistories[userPhone].push({ role: "user", content: message.text.body });

      const aiResponse = await getGPTResponse(conversationHistories[userPhone]);
      let responseTextToUser = aiResponse?.content;

      if (responseTextToUser) {
        conversationHistories[userPhone].push({ role: "assistant", content: responseTextToUser });
        await sendWhatsAppMessage(subscriber.phone, responseTextToUser); // Uses imported sendWhatsAppMessage
      } else {
        // Handle cases where AI response content is empty/null
        logger.warn({ userPhone }, `AI response content was empty.`);
        // Optionally send a fallback message
        // await sendWhatsAppMessage(subscriber.phone, "I\'m not sure how to respond to that. Could you try rephrasing?");
      }
      
    } catch (error) {
      logger.error({ err: error, userPhone }, `Error processing message`);
      await sendWhatsAppMessage(subscriber.phone, "Hey, I\'m currently suffering from bugs. The exterminator has been called already!"); // Uses imported sendWhatsAppMessage
    }
  }
  res.sendStatus(200);
});

// markMessageAsRead function moved to whatsapp.ts

app.get("/webhook", (req: any, res: any) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Check the mode and token sent are correct
  if (mode === "subscribe" && token === whatsappVerifyToken) {
    // Respond with challenge token from the request
    res.status(200).send(challenge);
    logger.info("Webhook verified successfully!");
  } else {
    // Respond with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
  }
});

app.get("/", (req: any, res: any) => {
  logger.info("/");
  res.send("Hi Mom");
});

// Set up static file serving for HTML files
app.use('/static', serveStatic(process.cwd() + "/static"));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
