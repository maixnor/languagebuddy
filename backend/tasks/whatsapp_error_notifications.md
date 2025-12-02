### Prompt: Implement WhatsApp Error Notifications

**Goal:** Send WhatsApp messages to the developer when critical application errors occur.

**Context:** Need immediate notification for critical issues without relying solely on logs or external monitoring services.

**Target:** Critical error handling locations in the codebase.

**Details:**
- Integrate `whatsappService.sendMessage` in critical error handlers.
- Configure what constitutes a "critical" error (e.g., digest failures, payment issues, API outages).
- The message should include error details, user context if applicable, and a prompt to check logs.

**Expected Impact:** Rapid detection and response to critical production issues.
