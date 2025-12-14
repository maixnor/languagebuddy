# Messaging Integration Analysis

## 1. Executive Summary
This document analyzes the technical requirements and effort to integrate five additional messaging providers into LanguageBuddy. The current architecture (Provider Service -> Messaging Orchestrator -> Agent) is well-suited for this expansion.

**Recommended Strategy:**
- **Telegram & LINE:** High priority. Low barrier to entry, simple APIs.
- **RCS & Apple Messages:** Medium priority. Requires business verification and likely an MSP (Messaging Service Provider) like **Sinch** or **Infobip** to avoid massive overhead.
- **KakaoTalk:** Low priority. Complex restrictions.

---

## 2. Current Architecture Baseline
- **Provider Layer:** `WhatsappService` (sends API requests).
- **Orchestration:** `MessagingService` (receives webhooks, normalizes data).
- **Agent:** `LanguageBuddyAgent` (provider-agnostic).

**Integration Pattern for New Providers:**
1.  **Transport:** Create `src/core/messaging/<provider>/<provider>.service.ts`.
2.  **Formatter:** Create `src/core/messaging/<provider>/<provider>.formatter.ts`.
3.  **Webhook:** Add endpoint in `src/routes.ts` -> `POST /webhook/<provider>`.
4.  **Orchestration:** Update `MessagingService` to accept generic `UnifiedMessage` types.

---

## 3. Provider Analysis

### 3.1 Telegram (Lowest Effort)
- **API Type:** HTTP REST (Bot API).
- **Auth:** Bot Token (Header/URL).
- **Webhook:** `setWebhook` to pointing to our server. JSON payload.
- **Media:**
    - Incoming: `file_id` -> `getFile` -> Download URL.
    - Outgoing: `sendPhoto`, `sendVoice` (requires OGG/OPUS).
- **Effort:** **Low (2-3 days)**. Very developer-friendly.

### 3.2 LINE (Low Effort)
- **API Type:** HTTP REST (Messaging API).
- **Auth:** Channel Access Token (Bearer).
- **Webhook:** Verifies signature in `x-line-signature`. JSON payload.
- **Media:**
    - Incoming: `GET /v2/bot/message/{messageId}/content` (Binary stream).
    - Outgoing: Reply token or Push API.
- **Effort:** **Low (3-4 days)**. Clean documentation, standard patterns.

### 3.3 RCS / Google Messages (Medium Effort)
- **API Type:** Google RBM API (REST/gRPC).
- **Auth:** Service Account (OAuth 2.0).
- **Webhook:** Requires verification handshake (`clientToken`, `secret`).
- **Prerequisites:** Must register as a Partner and pass verification.
- **Effort:** **Medium (5-7 days)**. Development is standard, but administrative setup (verification, agent launch) is slow.
- **Recommendation:** Use a wrapper/aggregator like **Sinch** or **Infobip** to unify APIs.

### 3.4 Apple Messages for Business (AMB) (High Effort)
- **API Type:** REST (via MSP usually).
- **Integration:** **Direct integration is extremely difficult.** You typically MUST use a Messaging Service Provider (MSP).
- **Recommended MSPs (Non-Twilio):**
    -   **Sinch:** Strong AMB support, global reach.
    -   **Infobip:** Enterprise-grade, good documentation.
    -   **CM.com:** Developer-friendly European provider.
    -   **LivePerson:** Conversational Cloud focus.
- **Auth:** OAuth 2.0.
- **Prerequisites:** Apple Business Register verification (DUNS number, etc.).
- **Effort:** **High (Technical: 5 days via MSP / Administrative: Weeks).**
- **Recommendation:** Choose Sinch or Infobip.

### 3.5 KakaoTalk (High Complexity)
- **API Type:** REST.
- **Constraint:** Standard API is "AlimTalk" (Notifications). 2-way "Consultation Talk" often requires using an official dealer or specific "Biz Message" setup. It is not as open as Telegram/LINE for bots.
- **Auth:** Access Token.
- **Effort:** **High (Unknown administrative blockers).**
- **Recommendation:** Re-evaluate necessity. If critical, investigate "Kakao Sync" or official "Chatbot" partners.

---

## 4. Effort Estimation Summary

| Provider | Tech Effort | Admin Effort | Prerequisites |
| :--- | :--- | :--- | :--- |
| **Telegram** | Low | None | BotFather setup (5 mins) |
| **LINE** | Low | Low | Developer Console setup |
| **RCS** | Medium | High | Google Partner Verification |
| **Apple** | Medium (via MSP) | Very High | Apple Business Verification |
| **KakaoTalk**| High | High | Biz Channel / Dealer setup |

**Total Estimated Dev Time for MVP (Telegram + LINE):** ~1 Week.