import express from "express";
import OpenAI from "openai";
import serveStatic from "serve-static"; // Changed from "npm:serve-static"
import dotenv from "dotenv"; // Added for Node.js environment variables

import "whatsapp-cloud-api-express";
import { readFileSync } from 'fs';
import path from 'path';
const yaml = require('js-yaml');

dotenv.config(); // Load environment variables for Node.js

const openAiToken = process.env.OPENAI_API_KEY;
const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const whatsappVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

const openai = new OpenAI({ apiKey: openAiToken });

// In-memory store for single-user conversation histories
const conversationHistories: { [key: string]: OpenAI.Chat.Completions.ChatCompletionMessageParam[] } = {};

// Define a type for the system prompt objects
interface SystemPromptEntry {
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
  console.log(`Loaded ${systemPrompts.length} system prompts from file`);
} catch (error) {
  console.error('Error loading system prompts from file:', error);
  defaultSystemPrompt = fallbackSystemPrompt;
  systemPrompts = [defaultSystemPrompt];
}

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
    await sendWhatsAppMessage(subscriber, helpText);
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
        await sendWhatsAppMessage(subscriber, `Definition of "${termToDefine}":\n${definitionResponse.content}`);
      } else {
        await sendWhatsAppMessage(subscriber, `Sorry, I couldn't define "${termToDefine}" at the moment.`);
      }
    } catch (error) {
      console.error(`Error defining term "${termToDefine}":`, error);
      await sendWhatsAppMessage(subscriber, "Sorry, there was an error getting the definition.");
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
    await sendWhatsAppMessage(subscriber, infoText);
    return true;
  }

  return false; // Not a recognized command
}

export const app = express();

app.use(express.json());

async function initiateConversation(subscriber: Subscriber, systemPrompt: SystemPromptEntry): Promise<boolean> {
  console.log(`Initiating single-user conversation for ${subscriber.phone} with system prompt: "${systemPrompt.prompt}" and first user message: "${systemPrompt.firstUserMessage}"`);
  
  conversationHistories[subscriber.phone] = [
    { role: "system", content: systemPrompt.prompt },
    { role: "user", content: systemPrompt.firstUserMessage }
  ];

  try {
    const initialGptResponse = await getGPTResponse(conversationHistories[subscriber.phone]);

    if (initialGptResponse?.content) {
      // Add AI's first response to history
      conversationHistories[subscriber.phone].push({ role: "assistant", content: initialGptResponse.content });
      return await sendWhatsAppMessage(subscriber, initialGptResponse.content);
    } else {
      console.error(`GPT did not generate an initial message for system prompt: "${systemPrompt}" and first user message: "${systemPrompt.firstUserMessage}" for phone: ${subscriber.phone}`);
      return false;
    }
  } catch (error) {
    console.error(`Error during conversation initiation for ${subscriber.phone}:`, error);
    return false;
  }
}

async function sendWhatsAppMessage(subscriber: Subscriber, text: string, messageIdToContext?: string): Promise<boolean> {
  const payload: any = {
    messaging_product: "whatsapp",
    to: subscriber.phone,
    text: { body: text },
  };
  if (messageIdToContext) {
    payload.context = { message_id: messageIdToContext };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${whatsappPhoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${whatsappToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      console.error(
        `Error sending WhatsApp message to ${subscriber.phone}:`,
        response.status,
        response.statusText,
        await response.text()
      );
      return false;
    }
    console.log(`WhatsApp message sent successfully to ${subscriber.phone}.`);
    return true;
  } catch (error) {
    console.error(`Exception sending WhatsApp message to ${subscriber.phone}:`, error);
    return false;
  }
}

app.post("/initiate", async (req: any, res: any) => {
  const { phone, promptSlug } = req.body;

  if (!phone || !promptSlug) {
    return res.status(400).send("Missing 'phone' or 'promptSlug' in request body.");
  }

  try {
    const success = await initiateConversation(phone, defaultSystemPrompt);
    if (success) {
      res.status(200).send("Conversation initiated successfully.");
    } else {
      res.status(500).send("Failed to initiate conversation.");
    }
  } catch (error) {
    console.error("Error reading or parsing system_prompts.json:", error);
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
      console.log(`New subscriber: ${userPhone}. Creating profile.`);
      subscriber = {
        phone: userPhone,
        speakingLanguages: [],
        learningLanguages: [],
        messageHistory: [] // This history is part of Subscriber, separate from conversationHistories
      };
      subscribers.push(subscriber);
    }

    // Handle user commands first
    if (await handleUserCommand(message.text.body, subscriber)) {
      return res.sendStatus(200); // Command was handled, stop further processing for this message
    }

    // If not a user command, and no conversation history, initiate one.
    if (!conversationHistories[userPhone]) {
      console.log(`Received message from ${userPhone}, but no conversation initiated. Starting with default start.`);
      await initiateConversation(subscriber, defaultSystemPrompt);
      // The current message triggered the initiation. User will reply to the bot's first message.
      return res.sendStatus(200);
    }

    // Process regular conversation message
    try {
      conversationHistories[userPhone].push({ role: "user", content: message.text.body });

      const aiResponse = await getGPTResponse(conversationHistories[userPhone]);
      let responseTextToUser = aiResponse.content;

      if (responseTextToUser) {
        conversationHistories[userPhone].push({ role: "assistant", content: responseTextToUser });
        await sendWhatsAppMessage(subscriber, responseTextToUser);
      } else {
        // Handle cases where AI response content is empty/null
        console.warn(`AI response content was empty for ${userPhone}.`);
        // Optionally send a fallback message
        // await sendWhatsAppMessage(subscriber, "I'm not sure how to respond to that. Could you try rephrasing?");
      }
      
    } catch (error) {
      console.error(`Error processing message for ${userPhone}:`, error);
      await sendWhatsAppMessage(subscriber, "Hey, I'm currently suffering from bugs. The exterminator has been called already!");
    }
  }
  res.sendStatus(200);
});

async function markMessageAsRead(messageId: string) {
  try {
    const readResponse = await fetch(
      `https://graph.facebook.com/v18.0/${whatsappPhoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${whatsappToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId
        })
      }
    );
    if (!readResponse.ok) {
      console.error(
        "Error marking message as read:",
        readResponse.status,
        readResponse.statusText,
        await readResponse.text()
      );
    } else {
      console.log(`Message ${messageId} marked as read.`);
    }
  } catch (error) {
    console.error(`Exception marking message ${messageId} as read:`, error);
  }
}

app.get("/webhook", (req: any, res: any) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Check the mode and token sent are correct
  if (mode === "subscribe" && token === whatsappVerifyToken) {
    // Respond with challenge token from the request
    res.status(200).send(challenge);
    console.log("Webhook verified successfully!");
  } else {
    // Respond with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
  }
});

app.get("/", (req: any, res: any) => {
  console.log("/");
  res.send("Hi Mom");
});

// Set up static file serving for HTML files
app.use('/static', serveStatic(process.cwd() + "/static"));

async function getGPTResponse(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  if (messages.length === 0 || messages[0].role !== 'system') {
    console.warn("getGPTResponse called with messages array not starting with a system prompt. Adding a default one.");
    messages.unshift({ role: "system", content: defaultSystemPrompt.prompt });
  }
  
  const filteredMessages = messages.filter(msg => msg.content && String(msg.content).trim() !== '');
  if (filteredMessages.length === 1 && filteredMessages[0].role === 'system') {
    console.warn("getGPTResponse called with only a system message. Adding a default one.");
    messages.push({role: "user", content: defaultSystemPrompt.firstUserMessage});
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: filteredMessages,
  });
  return completion.choices[0].message;
}

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
