### Prompt: Document Useful Log Queries

**Goal:** Create a documentation file (`debugging-cookbook.md`) with common debugging scenarios and useful log queries for `journalctl` and Loki.

**Context:** Need a quick reference for common debugging tasks using existing logging infrastructure.

**Target File:** `backend/docs/debugging-cookbook.md` (new file)

**Details:**
- Document common `journalctl` commands for filtering logs (e.g., by unit, time, keyword, user).
- Provide examples of Loki LogQL queries for advanced log analysis in Grafana.
- Include scenarios like: finding digest failures, tracking a specific user's journey, seeing conversation starts, identifying throttled users, checking timing of events.

**Expected Impact:** Faster and more efficient debugging by leveraging structured logs and dedicated query tools.
