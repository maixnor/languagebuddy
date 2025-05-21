// deno-lint-ignore-file no-explicit-any no-unused-vars
import express from "express";
import OpenAI from "openai";
import serveStatic from "npm:serve-static";
import axios from "npm:axios";
import * as fs from "node:fs"; // Import fs for reading the JSON file
import yaml from "npm:js-yaml"; // Added for YAML parsing

import "jsr:@std/dotenv/load";
import "whatsapp-cloud-api-express";

const openAiToken = Deno.env.get("OPENAI_API_KEY");
const whatsappToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const whatsappPhoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const whatsappVerifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

const openai = new OpenAI({ apiKey: openAiToken });

// In-memory store for single-user conversation histories
const conversationHistories: { [key: string]: OpenAI.Chat.Completions.ChatCompletionMessageParam[] } = {};

// Define a type for the system prompt objects
interface SystemPromptEntry {
  slug: string;
  prompt: string;
  firstUserMessage?: string; // Make it optional
}

const defaultSystemPrompt: SystemPromptEntry = {
  slug: "default",
  prompt: "You are a helpful language buddy trying his best to match the users language level but are always pushing the user to be slightly out of the comfort zone.",
  firstUserMessage: "Hi! Please ask me what language I want to learn with you and at what level I am."
}

interface Language {
  level: string;
  currentObjectives: string[];
}

// Data structures for group tours
interface Subscriber {
  phone: string;
  level: string;
  languages: Language[];
  messageHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

// Define subscribers array
const subscribers: Subscriber[] = [];

export const app = express();

app.use(express.json());

async function initiateConversation(subscriber: Subscriber, systemPrompt: SystemPromptEntry): Promise<boolean> {
  console.log(`Initiating single-user conversation for ${subscriber.phone} with system prompt: "${systemPrompt.prompt}" and first user message: "${systemPrompt.firstUserMessage}"`);
  
  conversationHistories[subscriber.phone] = [
    { role: "system", content: systemPrompt.prompt },
    { role: "user", content: systemPrompt.firstUserMessage }
  ];

  try {
    // Get only the first AI response based on the system prompt and the first user message
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

// Generic function to send a WhatsApp message
async function sendWhatsAppMessage(subscriber: Subscriber, text: string, messageIdToContext?: string): Promise<boolean> {
  const payload: any = {
    messaging_product: "whatsapp",
    to: subscriber.phone,
    text: { body: text },
  };
  console.log(payload);
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

// Helper function to send messages to a specific group member
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
    const subscriber = subscribers.find(p => p.phone === userPhone);
    console.log(subscriber);

    await markMessageAsRead(message.id);

    if (!conversationHistories[userPhone] || !subscriber) {
      console.log(`Received message from ${userPhone}, but no conversation initiated (single-user check). Starting with default start.`);
      
      if (!subscriber) {
        // Create a new subscriber if not found
        const newSubscriber: Subscriber = {
          phone: userPhone,
          level: "",
          languages: [],
          messageHistory: []
        };
        subscribers.push(newSubscriber);
        await initiateConversation(newSubscriber, defaultSystemPrompt);
      } else {
        await initiateConversation(subscriber, defaultSystemPrompt);
      }
      
      return res.sendStatus(200);
    }

    try {
      conversationHistories[userPhone].push({ role: "user", content: message.text.body });
      console.log(conversationHistories[userPhone]);

      const aiResponse = await getGPTResponse(conversationHistories[userPhone]);
      console.log(`\tSingleUser Incoming Message from ${userPhone}: `, message.text.body);
      console.log(`\tSingleUser Answer by GPT: `, aiResponse.content);

      if (aiResponse.content) {
        conversationHistories[userPhone].push({ role: "assistant", content: aiResponse.content });
        await sendWhatsAppMessage(subscriber, aiResponse.content);
      }
      
    } catch (error) {
      console.error("Error processing single-user message:", error);
      await sendWhatsAppMessage(subscriber, "Hey, I'm currently suffering from bugs. The exterminator has been called already!");
    }
  }
  res.sendStatus(200);
});

// Helper function to mark messages as read
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

// Webhook verification endpoint
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
app.use('/static', serveStatic(Deno.cwd() + "/static"));

async function getGPTResponse(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  // Ensure there's at least a system message if messages array is empty or lacks it.
  // This is a fallback, ideally messages should always be constructed with a system prompt.
  if (messages.length === 0 || messages[0].role !== 'system') {
    console.warn("getGPTResponse called with messages array not starting with a system prompt. Adding a default one.");
    messages.unshift({ role: "system", content: "You are a helpful assistant." });
  }
  
  // Prevent empty user/assistant messages which can cause API errors
  const filteredMessages = messages.filter(msg => msg.content && String(msg.content).trim() !== '');


  if (filteredMessages.length === 1 && filteredMessages[0].role === 'system') {
    // Avoid sending only a system message if there's no user input yet, can lead to empty/generic responses
    // This case should be handled by sending a predefined first message or ensuring user input exists.
    console.warn("getGPTResponse called with only a system message. This might lead to unexpected GPT behavior.");
    // Depending on strictness, you might return a default message or throw an error.
    // For now, we'll let it pass to OpenAI but log it.
  }


  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: filteredMessages, // Use filtered messages
  });
  return completion.choices[0].message;
}

const port = Deno.env.get("PORT") || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
