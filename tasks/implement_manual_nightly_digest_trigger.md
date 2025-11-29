### Prompt 2: Implement Manual Nightly Digest Trigger

**Goal:** Implement the `triggerNightlyDigests` function in `SchedulerService` to allow for manual initiation of the nightly digest process for all active subscribers.

**Target File:** `backend/src/features/scheduling/scheduler.service.ts`

**Details:**
*   The `triggerNightlyDigests` function currently has a `TODO` comment.
*   Its purpose is to iterate through all active subscribers and execute the `executeNightlyTasksForSubscriber` for each, similar to how the cron job does.
*   This manual trigger will be useful for testing, debugging, and potentially for administrative purposes.
*   Ensure proper logging is in place.
*   Consider adding a check to prevent concurrent runs if the scheduled job is also running (though for manual triggers, it might be acceptable to run on demand).