### Prompt 3: Implement Manual History Cleanup Trigger

**Goal:** Implement the `triggerHistoryCleanup` function in `SchedulerService` to allow for manual initiation of history cleanup for free-tier users.

**Target File:** `backend/src/features/scheduling/scheduler.service.ts`

**Details:**
*   The `triggerHistoryCleanup` function currently has a `TODO` comment.
*   This function should identify free-tier subscribers and trigger a history cleanup mechanism for them.
*   The definition of "history cleanup" should align with existing logic or be defined based on project requirements (e.g., removing messages older than X days, or simply triggering `clearConversation` for free users if that's the policy).
*   Ensure proper logging is in place.