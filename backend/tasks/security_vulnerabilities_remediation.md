# Task: Security Vulnerabilities Remediation & Hardening

**Goal:** Fix critical security vulnerabilities identified in the codebase and improve general security posture.

**Context:** A security audit revealed unauthenticated data leaks, missing signature verifications for webhooks, and vulnerable dependencies.

**Priority 1: Critical (Immediate Action Required)**

### 1. Secure `/subscriber/:phone` Endpoint
*   **Vulnerability:** Unauthenticated endpoint leaks full subscriber profiles (PII).
*   **Remediation:**
    *   Implement authentication (Admin API Key or internal network restriction).
    *   **Crucial:** Do not return the entire object. Return only specific, necessary fields.
    *   *Status:* Currently commented out in `routes.ts` as a temporary fix.

### 2. Secure `/analytics/feedback` Endpoint
*   **Vulnerability:** Unauthenticated endpoint leaks business intelligence and user feedback.
*   **Remediation:**
    *   Protect with Admin API Key.
    *   *Status:* Currently commented out in `routes.ts` as a temporary fix.

**Priority 2: High (Fix ASAP)**

### 3. Implement WhatsApp Webhook Signature Verification
*   **Vulnerability:** `POST /webhook` does not verify `X-Hub-Signature`. Attackers can spoof messages.
*   **Remediation:**
    *   Implement middleware to validate the signature using `WHATSAPP_APP_SECRET`.
    *   Must be done *before* body parsing or using `verifyBuffer`.

### 4. Implement Telegram Webhook Verification
*   **Vulnerability:** `POST /telegram/webhook` does not verify `X-Telegram-Bot-Api-Secret-Token`.
*   **Remediation:**
    *   Check the `X-Telegram-Bot-Api-Secret-Token` header against the configured secret.

### 5. Replace Vulnerable `axios` Dependency
*   **Vulnerability:** `whatsapp-cloud-api-express` uses a vulnerable version of `axios`.
*   **Remediation:**
    *   Remove `whatsapp-cloud-api-express`.
    *   Implement direct calls to WhatsApp Cloud API using Node's native `fetch` or a secure HTTP client.

**Priority 3: Medium (Hardening)**

### 6. Rate Limiting
*   **Remediation:** Add `express-rate-limit` to `main.ts` to prevent brute-force and DoS.

### 7. Security Headers
*   **Remediation:** Add `helmet` middleware to `main.ts`.
