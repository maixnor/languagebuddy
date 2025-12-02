### Prompt: Implement Grafana Dashboard Integration

**Goal:** Set up Grafana on the NixOS host to visualize application metrics and logs, and expose a metrics endpoint from the backend.

**Context:** Need visual insights into application performance and user behavior without complex infrastructure.

**Target Files:**
- `backend/src/routes.ts` (add new endpoint)
- NixOS configuration for Grafana, Loki, Promtail.

**Details:**
- **New endpoint:** `/api/admin/metrics` in `routes.ts`, protected by simple token authentication, to expose metrics for Grafana.
- Set up Grafana on NixOS.
- Configure Loki for log aggregation (using Promtail).
- Create Grafana dashboards with panels for:
  - **Last 7 Days Time Series:** Users active, conversations, digests created.
  - **Current Status Panel:** Total users, active today, premium subscribers (percentage), trial ending soon.
  - **Activity Stream:** Recent digest creations, conversation starts/ends, trial warnings, error events (from Loki).
  - **Top Deficiencies This Week:** Bar chart of deficiency practice counts.
  - **System Health Panel:** Redis/OpenAI response times, digest success rate, error count.

**Expected Impact:** Comprehensive, real-time visual monitoring of the application.
