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
import { handleGptCommands } from "./commands";
import OpenAI from "openai";
import { Subscriber, SystemPromptEntry, logger } from "./types";

dotenv.config();

const openAiToken = process.env.OPENAI_API_KEY;
const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const whatsappVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

// In-memory store for single-user conversation histories
const conversationHistories: { [key: string]: OpenAI.Chat.Completions.ChatCompletionMessageParam[] } = {};

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

const subscribers: Subscriber[] = [];

async function handleUserCommand(messageText: string, subscriber: Subscriber): Promise<boolean> {
  const commandParts = messageText.trim().split(" ");
  const mainCommand = commandParts[0].toLowerCase();

  if (mainCommand === "!help") {
    const helpText = "Available commands:\n" +
                     "!help - Show this help message\n" +
                     "!define <word> - Get definition of a word\n" +
                     "!myinfo - Show your current language profile";
    await sendWhatsAppMessage(subscriber.phone, helpText);
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
        await sendWhatsAppMessage(subscriber.phone, `Definition of "${termToDefine}":\n${definitionResponse.content}`);
      } else {
        await sendWhatsAppMessage(subscriber.phone, `Sorry, I couldn\'t define "${termToDefine}" at the moment.`);
      }
    } catch (error) {
      logger.error({ err: error, term: termToDefine }, `Error defining term "${termToDefine}":`);
      await sendWhatsAppMessage(subscriber.phone, "Sorry, there was an error getting the definition.");
    }
    return true;
  } else if (mainCommand === "!myinfo") {
    let infoText = `Your Language Profile:\n`;
    infoText += `Speaking Languages: ${subscriber.speakingLanguages.length > 0 ? subscriber.speakingLanguages.map(lang => lang.languageName).join(', ') : 'None set'}\n`; // Corrected this line
    infoText += "Learning Languages:\n";
    if (subscriber.learningLanguages.length > 0) {
      subscriber.learningLanguages.forEach(lang => {
        infoText += `  - ${lang.languageName}: Level ${lang.level} (Objectives: ${lang.currentObjectives.join(', ') || 'None'})\n`;
      });
    } else {
      infoText += "  None set\n";
    }
    await sendWhatsAppMessage(subscriber.phone, infoText);
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
    const initialGptResponse = await getGPTResponse(conversationHistories[subscriber.phone]);

    if (initialGptResponse?.content) {
      // Add AI's first response to history
      conversationHistories[subscriber.phone].push({ role: "assistant", content: initialGptResponse.content });
      return await sendWhatsAppMessage(subscriber.phone, initialGptResponse.content);
    } else {
      logger.error({ phone: subscriber.phone, prompt: systemPrompt.prompt, firstUserMessage: systemPrompt.firstUserMessage }, `GPT did not generate an initial message for system prompt`);
      return false;
    }
  } catch (error) {
    logger.error({ err: error, phone: subscriber.phone }, `Error during conversation initiation`);
    return false;
  }
}

app.post("/initiate", async (req: any, res: any) => {
  const { phone, promptSlug } = req.body;

  if (!phone || !promptSlug) {
    return res.status(400).send("Missing 'phone' or 'promptSlug' in request body.");
  }

  const hasPaid = await checkStripeSubscription(phone);
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
      name: "nothing specified",
      speakingLanguages: [],
      learningLanguages: [],
      messageHistory: []
    };
    subscribers.push(subscriber);
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

    await markMessageAsRead(message.id);

    if (!subscriber) {
      logger.info({ userPhone }, "New user messaging. Checking Stripe status.");
      const hasPaid = await checkStripeSubscription(userPhone);

      if (!hasPaid) {
        logger.info({ userPhone }, "User has not paid. Sending payment link.");
        await sendWhatsAppMessage(userPhone, "Welcome! To use me as your language buddy please complete your subscription here: https://buy.stripe.com/dRmbJ3bYyfeM1pLgPX8AE01 \nUse coupon code: 'STARTUP' until 8th of June 2025 for 100% off your first month since we are still in testing!");
        return res.sendStatus(200);
      }
      
      logger.info({ userPhone }, "New user has paid. Creating profile.");
      subscriber = {
        phone: userPhone,
        name: "nothing specified",
        speakingLanguages: [],
        learningLanguages: [],
        messageHistory: []
      };
      subscribers.push(subscriber);
      await initiateConversation(subscriber, defaultSystemPrompt);
      return res.sendStatus(200);
    }

    if (await handleUserCommand(message.text.body, subscriber)) {
      return res.sendStatus(200);
    }

    if (!conversationHistories[userPhone]) {
      logger.warn({ userPhone }, `No conversation history for subscriber. Initiating with default start.`);
      await initiateConversation(subscriber, defaultSystemPrompt);
      return res.sendStatus(200);
    }

    try {
      conversationHistories[userPhone].push({ role: "user", content: message.text.body });

      const aiResponse = await getGPTResponse(conversationHistories[userPhone]);
      let responseTextToUser = aiResponse?.content!;
      
      let gptCommandProcessedSuccessfully = false;
      let rawCommandFromGpt = "";

      ({ responseTextToUser, rawCommandFromGpt, gptCommandProcessedSuccessfully } = handleGptCommands(responseTextToUser, subscriber));

      // Logic for history and sending message
      if (aiResponse?.content || gptCommandProcessedSuccessfully) {
        conversationHistories[userPhone].push({ role: "assistant", content: responseTextToUser || "" });

        if (responseTextToUser && responseTextToUser.trim() !== "") {
          await sendWhatsAppMessage(subscriber.phone, responseTextToUser);
        } else if (gptCommandProcessedSuccessfully) {
          logger.info({ userPhone, command: rawCommandFromGpt }, "GPT command processed, no subsequent text message for user.");
        } else if (rawCommandFromGpt) { // A command was detected and stripped, but not successfully processed, and response is now empty
          logger.info({ userPhone, command: rawCommandFromGpt }, "A command-like line was stripped, resulting in an empty message. Nothing sent to user.");
        } else if (!responseTextToUser && aiResponse?.content) {
           // Original response was not empty, but became empty (e.g. was only a malformed command)
           logger.warn({ userPhone, originalContent: aiResponse.content }, "Original AI response was present but became empty after command processing attempts. Nothing sent to user.");
        }
      } else { // AI response was initially null/empty and no command was processed
        logger.warn({ userPhone }, `AI response content was null or empty, and no command processed.`);
        conversationHistories[userPhone].push({ role: "assistant", content: "" }); // Record an empty turn
        // TODO get a new response from GPT
      }
      
    } catch (error) {
      logger.error({ err: error, userPhone }, `Error processing message`);
      await sendWhatsAppMessage(subscriber.phone, "Hey, I'm currently suffering from bugs. The exterminator has been called already!");
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


