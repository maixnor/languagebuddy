# Test Coverage Gaps & Prioritization

This document lists critical logic areas that lack sufficient test coverage. 
**Rule:** When touching code in these areas, you MUST add tests first (Red-Green-Refactor).

## Severity 1: Critical Business Logic (High Risk)
*Direct impact on revenue, user retention, or core functionality.*

1.  **Throttling & Trial Logic** (`SubscriberService`)
    *   **Files:** `backend/src/services/subscriber-service.ts`
    *   **Methods:** `shouldThrottle()`, `canStartConversationToday()`, `getDaysSinceSignup()`
    *   **Risk:** Free users getting unlimited access; Premium users getting blocked; Timezone edge cases causing premature/late resets.
    *   **Missing:** Comprehensive unit tests for timezone boundaries, exact day-7 cutoffs, and leap years.

2.  **Payment Verification** (`StripeService`)
    *   **Files:** `backend/src/services/stripe-service.ts`
    *   **Methods:** `checkSubscription()`
    *   **Risk:** False negatives (paid users blocked).
    *   **Missing:** Robust unit tests with mocked Stripe responses for various subscription statuses (active, past_due, canceled).

3.  **Nightly Scheduler** (`SchedulerService`)
    *   **Files:** `backend/src/services/scheduler-service.ts`
    *   **Methods:** Timezone calculation logic for "Is it 3 AM for this user?"
    *   **Risk:** Digests never running, or running at wrong times (spamming users at night).
    *   **Missing:** Unit tests for `isNightTimeForUser(timezone)` logic.

## Severity 2: Feature Integrity (Medium Risk)
*Impacts user experience and feature reliability.*

4.  **User Commands** (`util/user-commands.ts`)
    *   **Files:** `backend/src/util/user-commands.ts`
    *   **Methods:** `handleUserCommand` (!digest, !clear, !night)
    *   **Risk:** Commands failing silently or throwing errors, leaving users stuck.
    *   **Missing:** Unit tests for each command string, ensuring they call the correct service methods.

5.  **Webhook Payload Handling** (`WebhookService`)
    *   **Files:** `backend/src/services/webhook-service.ts`
    *   **Methods:** `handleWebhookMessage`, `processTextMessage`
    *   **Risk:** Service crashing on malformed WhatsApp payloads; Security bypasses.
    *   **Missing:** Unit tests for payload validation and error handling.

6.  **Onboarding State Machine** (`OnboardingService`)
    *   **Files:** `backend/src/services/onboarding-service.ts`
    *   **Risk:** Users getting stuck in loops or skipping steps.
    *   **Missing:** Unit tests for state transitions (e.g., `startOnboarding` -> `waiting_for_name`).

## Severity 3: Maintenance & Stability (Low Risk)
*Indirect impact or lower probability of failure.*

7.  **Agent Tools** (`tools/subscriber-tools.ts`)
    *   **Methods:** `update_subscriber_profile`, `get_subscriber_profile`
    *   **Risk:** Agent failing to save data.
    *   **Missing:** Direct unit tests (currently relying on E2E/Agent tests).

8.  **Message Deduplication** (`WhatsAppDeduplicationService`)
    *   **Risk:** Double responses to users.
    *   **Missing:** Unit tests with Redis mocks for key expiration.
