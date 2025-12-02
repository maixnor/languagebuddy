### Prompt: Implement Time-Aware Conversation Context System

**Goal:** Add timestamp awareness to conversation history, enabling the agent to understand conversation pacing and naturally end/resume conversations based on time gaps.

**Context:** The agent currently lacks temporal awareness, leading to unnatural conversation flows and missed opportunities for engagement.

**Implementation Requirements:**

1.  **Enhanced Message Storage (`redis-checkpointer.ts`):**
    *   Extend message objects within the LangGraph checkpoint to include a `timestamp` field.
    *   When saving messages, automatically add `message.timestamp = new Date().toISOString()`.
    *   Ensure the LangGraph checkpointer preserves this custom metadata.
    *   Add `conversationStartedAt` to the checkpoint metadata.

2.  **Time-Aware System Prompt (`system-prompts.ts`):**
    *   Inject temporal context into the system prompt: current time, conversation start time, and time since the last message.
    *   Calculate and expose time gaps between messages (e.g., "User replied after 2 hours").
    *   Inject instructions for the agent's behavior based on these time gaps:
        *   `<5 min`: Normal rapid conversation.
        *   `5-60 min`: Acknowledge break naturally (e.g., "Back to our conversation!").
        *   `1-6 hours`: Reference the time gap (e.g., "Good to hear from you again!").
        *   `6-24 hours`: Treat as a new conversation day.
        *   `>24 hours`: Offer a warm welcome back, potentially recap the previous topic.

3.  **Conversation Flow Management (`language-buddy-agent.ts`):**
    *   Add helper methods `getConversationDuration()` and `getTimeSinceLastMessage()`.
    *   Inject this temporal context into each message processing step.
    *   Implement logic for natural conversation ending after 30-45 minutes of active chat.
    *   Implement night-time awareness: Calculate the user's local time from their timezone; if it's 10 PM - 6 AM, suggest ending the conversation (e.g., "It's getting late, we should continue tomorrow!").
    *   Mark conversations as "ended_naturally" versus "interrupted."

4.  **Re-Engagement After Gaps:**
    *   If more than 48 hours have passed since the last message, the agent should reference the previous conversation topic (e.g., "Last time we were discussing [topic from digest], shall we continue?").
    *   Pull context from the most recent digest to provide continuity.

**Expected Impact:** More natural and human-like conversation flow, graceful conversation endings, better context after breaks, and a foundation for sophisticated engagement patterns.
