### Prompt: Prevent One-Shot Messages from Persisting in Conversation History

**Goal:** Modify the `oneShotMessage` method in `LanguageBuddyAgent` so that its messages (both input prompt and AI response) do not become part of the persistent LangGraph conversational history.

**Context:** The `oneShotMessage` method is intended for single, isolated interactions that should not influence the main conversational flow or be saved in the LangGraph checkpoint.

**Target File:** `backend/src/agents/language-buddy-agent.ts`

**Details:**
- Currently, `oneShotMessage` uses `this.agent.invoke` which, by default, would save messages to the checkpoint if `thread_id` is provided.
- Investigate how to invoke the LangGraph agent in a "stateless" or "non-persisting" mode for this specific method. This might involve using a temporary `thread_id` or a different invocation strategy that bypasses the `checkpointer` for this call.
- Ensure the AI still receives the `systemPrompt` and generates a response based on it, but this specific exchange is *not* saved to the persistent conversation history.

**Expected Impact:** Cleaner conversation history, improved token management for one-off requests, and clearer separation of conversational state.
