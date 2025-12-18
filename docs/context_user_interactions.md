# User Interactions Flow

```mermaid
sequenceDiagram
    participant User
    participant WhatsApp
    participant Backend
    participant LLM
    participant SQLite

    User->>WhatsApp: Sends message
    WhatsApp->>Backend: Forwards message (webhook)
    Backend->>SQLite: Check conversation state
    Backend->>LLM: Send user message + context
    LLM-->>Backend: LLM response
    Backend->>SQLite: Update conversation state
    Backend->>WhatsApp: Send reply to user
    WhatsApp-->>User: Delivers reply
```

This diagram shows the flow of user interactions from message sending to LLM response and state management.
