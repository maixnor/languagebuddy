# Project Overview: LanguageBuddy

LanguageBuddy is a conversational platform that leverages LLMs (Large Language Models) to interact with users via WhatsApp. The backend manages user sessions, conversation context, and subscription status, integrating with SQLite for persistent state management and Whatsapp API for messaging. The system is designed for scalable, context-aware language learning and assistance.

## Key Components
- **WhatsApp Integration**: Receives and sends messages via Twilio.
- **Backend Service**: Handles message routing, context management, and LLM communication.
- **LLM (e.g., OpenAI, Azure, etc.)**: Provides intelligent conversational responses.
- **SQLite**: Stores subscriber data and conversation states for persistent access.
- **Stripe**: Manages subscriptions and payments.

## High-Level Flow
1. User sends a message on WhatsApp.
2. Message is received by the backend via webhook.
3. Backend checks/updates conversation state in SQLite.
4. Backend queries LLM for a response.
5. Response is sent back to the user via WhatsApp.
6. Subscription and payment handled via Stripe as needed.

The architecture is modular, allowing for easy extension and integration with additional services or channels.
