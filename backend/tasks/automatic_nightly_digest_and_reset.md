### Prompt: Implement Automatic Nightly Conversation Digest & Reset System

**Goal:** Fully implement the automatic process for creating conversation digests, updating user profiles, and resetting conversation history at the user's local 3 AM.

**Context:** Conversations currently grow indefinitely. This feature ensures regular summarization, context retention, and history cleanup, crucial for continuous learning and token management.

**Implementation Requirements:**

1.  **Timezone-Aware Scheduling (`scheduler.service.ts`):**
    *   Add a new cron job that runs hourly (or every 30 minutes).
    *   For each subscriber, calculate if it's currently 3 AM in their timezone (using `DateTime.fromISO(subscriber.profile.timezone)`).
    *   Track the `lastDigestDate` in subscriber metadata to prevent duplicate digests within the same 24-hour period.

2.  **Automatic Digest Creation:**
    *   Check if the user has an active conversation (e.g., >5 messages since last digest).
    *   Call `digestService.createConversationDigest(subscriber)`.
    *   Save the created digest to the `subscriber.metadata.digests[]` array.
    *   Extract user memos and merge them with existing profile data.
    *   Update deficiencies based on `areasOfStruggle` from the digest.
    *   Update vocabulary tracking if the structure exists.
    *   Increment conversation statistics (e.g., total conversations, messages exchanged).

3.  **Conversation History Cleanup:**
    *   After the digest is created and saved, clear the LangGraph conversation checkpoint.
    *   Call `languageBuddyAgent.clearConversation(phone)`.
    *   Ensure system prompts and essential context are preserved, but the chat buffer is wiped.

4.  **Fallback for Silent Users:**
    *   If a user hasn't messaged in 2+ days, send a gentle re-engagement message.
    *   Ensure a minimum of 2 messages per week even without user replies (if applicable, based on product strategy).
    *   Track "last message sent" separately from "last user reply".

**Expected Impact:** Focused conversations, continuous learning progress tracking, richer user profiles, reduced token costs, and consistent user engagement.
