### Prompt: Create Daily Developer Digest (WhatsApp)

**Goal:** Create a script to send a daily WhatsApp message to the developer with key application statistics.

**Context:** Need a quick overview of system health and user activity without complex dashboards.

**Target File:** `backend/src/scripts/daily-dev-digest.ts` (new file)

**Details:**
- The script should run daily (e.g., via cron) at a specified time (e.g., 8 AM developer's time).
- It should use the existing WhatsApp integration to send a message to a configured admin phone number.
- The message content should include:
  - Total users, active users today.
  - Number of conversations today.
  - Number of digests created last night.
  - Revenue stats (premium users, MRR).
  - Any critical issues (e.g., digest failures).
  - Top deficiencies practiced.

**Expected Impact:** Daily, at-a-glance summary of application performance and user engagement.
