import express, { Request, Response } from "express";
import OpenAI from "openai";
import serveStatic from "serve-static"; // Changed from npm:serve-static
import axios from "axios"; // Changed from npm:axios
import * as fs from "fs"; // Changed from node:fs
import yaml from "js-yaml"; // Changed from npm:js-yaml
import { createClient } from "redis"; // Changed from npm:redis
import Stripe from "stripe"; // Changed from npm:stripe
import dotenv from "dotenv"; // Added for .env file loading

dotenv.config(); // Load environment variables from .env file

// Replace Deno.env.get with process.env
const openAiToken = process.env.OPENAI_API_KEY;
const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const whatsappVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const valkeyUrl = process.env.VALKEY_URL || "redis://langbud_valkey:6379";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePriceId = process.env.STRIPE_PRICE_ID;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // Added for Stripe webhook verification

const openai = new OpenAI({ apiKey: openAiToken });

// Initialize Valkey client
const valkeyClient = createClient({ url: valkeyUrl });
valkeyClient.on("error", (err) => console.error("Valkey Client Error", err));
async function connectValkey() {
  if (!valkeyClient.isOpen) {
    try { // Added try-catch for connection
      await valkeyClient.connect();
      console.log("Connected to Valkey");
    } catch (err) {
      console.error("Failed to connect to Valkey:", err);
    }
  }
}
// connectValkey(); // Consider calling this at app startup if Valkey is essential immediately

// Initialize Stripe client
let stripe: Stripe | null = null;
if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-04-10" });
  console.log("Stripe client initialized.");
} else {
  console.warn("STRIPE_SECRET_KEY not found. Stripe integration will be disabled.");
}

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
  messageHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; // Keep OpenAI type
  activeSubscription?: boolean; 
  stripeCustomerId?: string; 
}

export const app = express();

app.use(express.json());

async function initiateConversation(subscriber: Subscriber, systemPrompt: SystemPromptEntry): Promise<boolean> {
  console.log(`Initiating single-user conversation for ${subscriber.phone} with system prompt: "${systemPrompt.prompt}" and first user message: "${systemPrompt.firstUserMessage}"`); // Corrected template literal
  
  // Initialize history with system prompt and the first user message
  conversationHistories[subscriber.phone] = [
    { role: "system", content: systemPrompt.prompt }, // Ensure this is a string
    { role: "user", content: systemPrompt.firstUserMessage || "" } // Ensure content is a string, provide fallback
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
app.post("/initiate", async (req: Request, res: Response) => { // Changed from any to Request, Response
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

app.post("/webhook", async (req: Request, res: Response) => { // Changed from any to Request, Response
  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];

  if (message?.type === "text") {
    const userPhone = message.from;
    let subscriber: Subscriber | null = null; // Keep this type

    // 1. Try to get subscriber from Valkey
    try {
      // Ensure Valkey client is connected before use
      await connectValkey(); 
      const subscriberJson = await valkeyClient.get(`subscriber:${userPhone}`);
      if (subscriberJson) {
        subscriber = JSON.parse(subscriberJson) as Subscriber;
        console.log(`Subscriber ${userPhone} found in Valkey.`);
        // If found in Valkey, check if subscription is active
        if (!subscriber.activeSubscription) {
          console.log(`Subscriber ${userPhone} found but subscription is not active. Sending payment link.`);
          if (stripe && stripePriceId) {
            await sendPaymentLink(userPhone, stripePriceId);
            await markMessageAsRead(message.id);
            return res.sendStatus(200);
          } else {
            console.warn(`Stripe not configured. Cannot send payment link to inactive subscriber ${userPhone}.`);
            // Optionally send a message indicating service is unavailable due to payment issue
            await sendWhatsAppMessage({ phone: userPhone, level: "unknown", languages: [], messageHistory: [] }, "I am unable to process your request at this time due to a payment system issue.");
            await markMessageAsRead(message.id);
            return res.sendStatus(200);
          }
        }
      } else {
        console.log(`Subscriber ${userPhone} not found in Valkey.`);
      }
    } catch (err) {
      console.error(`Error fetching subscriber ${userPhone} from Valkey:`, err);
    }

    // If subscriber not found in cache OR not active, check Stripe (or send payment link)
    if (!subscriber || !subscriber.activeSubscription) {
      if (stripe && stripePriceId) {
        // This logic path is for users not in Valkey or in Valkey but inactive.
        // The primary way to become active is via Stripe webhook after payment.
        // So, if they are not active here, they need to pay.
        console.log(`Subscriber ${userPhone} not active or not found. Sending payment link.`);
        await sendPaymentLink(userPhone, stripePriceId);
        await markMessageAsRead(message.id);
        return res.sendStatus(200);
      } else {
        console.warn(`Stripe client not initialized or STRIPE_PRICE_ID missing. Cannot check subscription or send payment link for ${userPhone}.`);
        // Send a message to the user that payment system is unavailable
        const tempSubscriberOnError: Subscriber = { phone: userPhone, level: "unknown", languages: [], messageHistory: [] }; 
        await sendWhatsAppMessage(tempSubscriberOnError, "Sorry, I can\'t set up a new subscription for you at the moment. Please try again later."); // Escaped apostrophe
        await markMessageAsRead(message.id);
        return res.sendStatus(200);
      }
    }

    // At this point, 'subscriber' should be populated AND active.
    // ... rest of the message handling logic ...

    if (!conversationHistories[userPhone]) {
        // This case might occur if subscriber was found/created but history wasn't initialized yet for this session
        console.log(`No active conversation history for ${userPhone}, but subscriber exists. Initializing with system prompt.`);
        conversationHistories[userPhone] = [{ role: "system", content: defaultSystemPrompt.prompt }];
        // Optionally, send the firstUserMessage if defined and it's truly a new conversation start
        if (defaultSystemPrompt.firstUserMessage && subscriber.messageHistory.length === 0) { // Check if it's a truly new interaction for this subscriber
             conversationHistories[userPhone].push({ role: "user", content: defaultSystemPrompt.firstUserMessage });
             // The initial response will be handled by the getGPTResponse block below
        }
    }


    try {
      conversationHistories[userPhone].push({ role: "user", content: message.text.body });
      // Update subscriber's message history in Valkey as well (optional, depending on needs)
      // subscriber.messageHistory = conversationHistories[userPhone]; 
      // await valkeyClient.set(`subscriber:${userPhone}`, JSON.stringify(subscriber));

      const aiResponse = await getGPTResponse(conversationHistories[userPhone]);
      console.log(`\tSingleUser Incoming Message from ${userPhone}: `, message.text.body);
      console.log(`\tSingleUser Answer by GPT: `, aiResponse.content);

      if (aiResponse.content) {
        conversationHistories[userPhone].push({ role: "assistant", content: aiResponse.content });
        // Corrected sendWhatsAppMessage call: needs a Subscriber object
        const currentSubscriber = await valkeyClient.get(`subscriber:${userPhone}`);
        if (currentSubscriber) {
            await sendWhatsAppMessage(JSON.parse(currentSubscriber) as Subscriber, aiResponse.content);
        } else {
            // Fallback if subscriber not in Valkey, though ideally they should be
            await sendWhatsAppMessage({ phone: userPhone, level: "", languages: [], messageHistory: [] }, aiResponse.content);
        }
      }
      
      await markMessageAsRead(message.id);

    } catch (error) {
      console.error("Error processing single-user message:", error);
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
app.get("/webhook", (req: Request, res: Response) => { // Changed from any to Request, Response
  const mode = req.query["hub.mode"] as string; // Added type assertion
  const token = req.query["hub.verify_token"] as string; // Added type assertion
  const challenge = req.query["hub.challenge"] as string; // Added type assertion

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

app.get("/", (req: Request, res: Response) => { // Changed from any to Request, Response
  console.log("/");
  res.send("Hi Mom");
});

// Set up static file serving for HTML files
// Replace Deno.cwd() with process.cwd()
app.use('/static', serveStatic(process.cwd() + "/static"));

async function getGPTResponse(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  // Ensure there's at least a system message if messages array is empty or lacks it.
  // This is a fallback, ideally messages should always be constructed with a system prompt.
  if (messages.length === 0 || messages[0].role !== 'system') {
    console.warn("getGPTResponse called with messages array not starting with a system prompt. Adding a default one.");
    messages.unshift({ role: "system", content: "You are a helpful assistant." });
  }
  
  // Prevent empty user/assistant messages which can cause API errors
  const filteredMessages = messages.filter(msg => msg.content && String(msg.content).trim() !== '');


  if (filteredMessages.length === 0) { // If all messages were filtered out (e.g. empty system prompt)
    console.error("Cannot send empty message array to OpenAI. Original messages:", messages);
    // Return a default or error message structure expected by the caller
    return { role: "assistant", content: "I encountered an issue processing your request. Please try again." }; 
  }


  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: filteredMessages, // Use filtered messages
  });
  return completion.choices[0].message;
}

// Payment link sending function
async function sendPaymentLink(userPhone: string, priceId: string): Promise<boolean> {
  if (!stripe) {
    console.error("Stripe client not initialized. Cannot send payment link.");
    return false;
  }
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription', 
      client_reference_id: userPhone, // Pass userPhone to identify in webhook
      // success_url and cancel_url removed as communication is via WhatsApp
    });

    if (session.url) {
      const paymentMessage = `To continue, please complete your subscription: ${session.url}`;
      const tempRecipient = { phone: userPhone, level: "", languages: [], messageHistory: [] };
      return await sendWhatsAppMessage(tempRecipient, paymentMessage);
    } else {
      console.error("Stripe session URL not found.");
      return false;
    }
  } catch (error) {
    console.error(`Error creating Stripe checkout session for ${userPhone}:`, error);
    return false;
  }
}

// Stripe Webhook Endpoint
app.post("/stripe-webhook", express.raw({type: 'application/json'}), async (req: Request, res: Response) => {
  if (!stripe || !stripeWebhookSecret) {
    console.error("Stripe or webhook secret not configured.");
    return res.sendStatus(500);
  }

  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, stripeWebhookSecret);
  } catch (err: any) {
    console.error(`⚠️  Webhook signature verification failed.`, err.message);
    return res.sendStatus(400);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      const userPhone = session.client_reference_id;
      const stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

      if (!userPhone) {
        console.error("Webhook received checkout.session.completed without client_reference_id (userPhone).");
        return res.sendStatus(400); // Bad request, missing identifier
      }

      console.log(`Checkout session completed for user: ${userPhone}, Stripe Customer ID: ${stripeCustomerId}`);

      try {
        let subscriberJson = await valkeyClient.get(`subscriber:${userPhone}`);
        let subscriber: Subscriber;

        if (subscriberJson) {
          subscriber = JSON.parse(subscriberJson) as Subscriber;
          subscriber.activeSubscription = true;
          subscriber.stripeCustomerId = stripeCustomerId;
        } else {
          // New subscriber from successful payment
          subscriber = {
            phone: userPhone,
            level: "beginner", // Default level, adjust as needed or get from metadata
            languages: [],
            messageHistory: [],
            activeSubscription: true,
            stripeCustomerId: stripeCustomerId,
          };
        }
        await valkeyClient.set(`subscriber:${userPhone}`, JSON.stringify(subscriber));
        console.log(`Subscriber ${userPhone} updated/created in Valkey with active subscription.`);

        // Send WhatsApp confirmation
        await sendWhatsAppMessage(subscriber, "Thank you! Your subscription is now active. You can continue our conversation.");
        
        // Optionally, initiate a welcome sequence or re-engage conversation
        // if (!conversationHistories[userPhone]) {
        //   initiateConversation(subscriber, defaultSystemPrompt);
        // }

      } catch (err) {
        console.error(`Error processing checkout.session.completed for ${userPhone}:`, err);
        // If this fails, the user paid but we couldn't update our system.
        // Implement retry logic or manual follow-up.
        return res.sendStatus(500); // Internal server error
      }
      break;
    case 'invoice.payment_failed':
      const invoice = event.data.object as Stripe.Invoice;
      const customerIdForFailure = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      console.log(`Invoice payment failed for Stripe Customer ID: ${customerIdForFailure}`);
      // Find user by stripeCustomerId in Valkey (requires iterating or secondary index if many users)
      // For now, we assume we can find them if needed, or we rely on client_reference_id if available on the event
      // This event might not have client_reference_id directly, so you might need to look up the customer
      // and then find their phone number from your records.
      // For simplicity, if we can get a phone number, we notify them.
      // This part needs more robust user identification based on Stripe Customer ID.
      // Example: const userPhone = await findUserPhoneByStripeCustomerId(customerIdForFailure);
      // if (userPhone) { 
      //   await sendWhatsAppMessage({ phone: userPhone, level:"", languages:[], messageHistory:[]}, "We had an issue with your recent payment. Please update your payment method in Stripe.");
      //   // Optionally, mark subscription as inactive
      // }
      break;
    // Add other event types to handle as needed (e.g., subscription cancellations)
    default:
      console.log(`Unhandled Stripe event type ${event.type}`);
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 3000; // Replace Deno.env.get
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  connectValkey(); // Connect to Valkey when server starts
});
