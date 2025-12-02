### Prompt: Implement Lightweight Redis-based Metrics

**Goal:** Store simple daily application metrics in Redis for quick access by other scripts and dashboards.

**Context:** Need basic operational metrics without introducing a heavy-duty metrics system like Prometheus initially.

**Target:** Various service files where events occur (e.g., conversation start, digest creation, deficiency practice).

**Details:**
- Use Redis `INCR` and `HINCRBY` commands to increment counters for daily events.
- Examples: `metrics:YYYY-MM-DD:conversations`, `metrics:YYYY-MM-DD:digests_created`, `metrics:YYYY-MM-DD:deficiencies:{type}`.
- Set keys to expire automatically after a certain period (e.g., 30 days) to prevent Redis from filling up.
- These metrics will be read by the daily developer digest script and the Grafana dashboard.

**Expected Impact:** Easy access to key operational statistics, low overhead.
