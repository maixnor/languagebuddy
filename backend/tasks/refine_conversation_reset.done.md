### Prompt 1: Refine Conversation Reset

**Goal:** Modify the `clearConversation` logic to be less destructive, retaining specific, essential context within the LangGraph checkpoint while clearing the message history.

**Target File:** `backend/src/persistence/redis-checkpointer.ts` and potentially `backend/src/agents/language-buddy-agent.ts`.

**Details:**
*   Currently, `RedisCheckpointSaver.clearUserHistory` completely deletes the Redis key `checkpoint:{phone}`. This removes all LangGraph state, including system prompts and potentially other persistent conversational context that should remain.
*   The objective is to clear only the *message history* or *chat buffer* within the LangGraph checkpoint, allowing the agent to start a new conversation contextually without losing core system instructions or user-specific conversational settings.
*   Investigate LangGraph's checkpoint structure to identify which part holds the message history and how to modify it while preserving other parts of the state (e.g., `graph.state.messages` or a similar structure).
*   If direct modification of the checkpoint JSON in Redis is required, ensure it's done safely and correctly.
*   Update `RedisCheckpointSaver.clearUserHistory` (or create a new method) to perform this selective clearing.
*   Ensure that existing test cases for `clearConversation` are updated or new ones are added to verify this selective clearing behavior.
