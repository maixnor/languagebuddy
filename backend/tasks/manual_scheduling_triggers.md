### Prompt: Implement Manual Scheduling Triggers

**Goal:** Implement manual trigger functions in `SchedulerService` for history cleanup and nightly digests.

**Context:** These manual triggers are essential for testing, debugging, and potentially administrative purposes.

**Target File:** `backend/src/features/scheduling/scheduler.service.ts`

**Details:**

1.  **`triggerHistoryCleanup`:**
    *   This function should identify free-tier subscribers.
    *   For identified free-tier subscribers, it should trigger a history cleanup mechanism. This might involve calling `languageBuddyAgent.clearConversation(phone)` or another defined cleanup policy for free users.
    *   Ensure proper logging is in place.

2.  **`triggerNightlyDigests`:**
    *   This function should iterate through all active subscribers.
    *   For each active subscriber, it should execute the `executeNightlyTasksForSubscriber` (or similar logic that the cron job will use).
    *   Ensure proper logging is in place.
    *   Consider adding a check to prevent concurrent runs if the automatic scheduled job is also running (though for manual triggers, it might be acceptable to run on demand).

**Expected Impact:** Improved testing capabilities and administrative control over scheduled tasks.
