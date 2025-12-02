### Prompt: Develop Redis Debugging CLI Tools

**Goal:** Create command-line interface tools for debugging user profiles and system health, leveraging Redis data.

**Context:** Manual Redis debugging (`just checkpoint`) is cumbersome. Need quick access to relevant user and system information.

**Target Files:**
- `backend/src/scripts/debug-user.ts` (new file)
- `backend/src/scripts/system-health.ts` (new file)

**Details:**

**`debug-user.ts` (example usage: `npm run debug:user -- --phone=+123456789`)**
- Shows:
  - User profile (formatted nicely).
  - Current conversation state.
  - Recent digests (last 3).
  - Deficiencies and when last practiced.
  - Subscription status and trial days remaining.
  - Last 5 log events for this user.

**`system-health.ts` (example usage: `npm run health-check`)**
- Shows:
  - Connection status for Redis, OpenAI API, WhatsApp API, Stripe API.
  - Number of active conversations.
  - Number of digests pending.
  - Number of users needing re-engagement.

**Expected Impact:** Faster debugging of user-specific issues and overall system health checks.
