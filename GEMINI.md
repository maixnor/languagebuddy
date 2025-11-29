# LanguageBuddy Project Context for Gemini

## 1. Project Overview
**LanguageBuddy** is a WhatsApp-based language learning service. It uses:
- **LangGraph** for stateful conversational agents.
- **OpenAI GPT-4** for intelligence.
- **Redis** for persistent state (conversation history, user profiles).
- **WhatsApp Cloud API** for user interface.
- **TypeScript/Node.js** backend.

## 2. Architecture & Core Patterns

### Services (Dependency Injection)
- **`ServiceContainer`**: Central singleton container initializing all services (`backend/src/services/service-container.ts`).
- **All Services**: Follow `getInstance(redis)` pattern.

### Data Model (Redis)
- **Conversation State**: `checkpoint:${phone}` (Managed by LangGraph `RedisCheckpointSaver`).
- **User Profile**: `subscriber:phone:${phone}` (Managed by `SubscriberService`).
- **Onboarding State**: `onboarding:${phone}` (Managed by `OnboardingService`).

### The Agent (`LanguageBuddyAgent`)
- Uses `createReactAgent`.
- **Thread ID**: The user's phone number.
- **Tools**: Located in `backend/src/tools/`.
    - **Critical**: Agent *must* use tools to read/write subscriber data (`get_subscriber_profile`, `update_subscriber_profile`). It cannot access Redis directly.

## 3. Development Workflow

### Local Testing (CLI Mode)
**Crucial**: Do not test against live WhatsApp API during dev. Use the CLI simulator.
1.  **Backend**: `cd backend && npm run dev:cli` (Starts server with `USE_LOCAL_CLI_ENDPOINT`).
2.  **Simulator**: `cd backend && npm run cli` (Interactive terminal chat).

### ⚠️ Testing Mandate ⚠️
**Every new feature or bug fix MUST include tests.**
The codebase currently lacks sufficient coverage. We must aggressively add tests with every change.
-   **No "blind" coding**: Write the test, watch it fail, implement the fix, watch it pass.
-   **Refactoring**: If you refactor, add tests *before* touching the code to ensure parity.

### Testing Strategy
1.  **Unit Tests** (`*.test.ts`) - **PREFERRED**
    -   **Scope**: Individual functions/methods (business logic).
    -   **Mocks**: Mock EVERYTHING external (Redis, OpenAI, other services).
    -   **Performance**: Must run in <200ms.
    -   **Usage**: `npm test` (runs fast).

2.  **Integration Tests** (`*.int.test.ts`) - **REQUIRED for State/Service Logic**
    -   **Scope**: Service interactions, Redis state persistence, complex workflows.
    -   **Mocks**: Real Redis (local/container), MOCK OpenAI/LLM calls.
    -   **Usage**: Use `OnboardingTestHelper` or similar fixtures.

3.  **E2E Tests** (`*.e2e.test.ts`) - **SPARINGLY**
    -   **Scope**: Full system flow including real OpenAI responses.
    -   **Cost**: Expensive and slow. Use only for critical "happy path" verification of the full bot.

### Critical Test Gaps (Prioritize These)
See [TEST_GAPS.md](./TEST_GAPS.md) for a comprehensive, prioritized list of missing tests.
-   **Throttling Logic**: `SubscriberService.shouldThrottle()` & `canStartConversationToday()`. (Fragile edge cases).
-   **Stripe Integration**: Webhooks, subscription status updates.
-   **Trial Transitions**: Day 7 cutoff, day 3-6 warnings.
-   **Conversation Counts**: Daily increments and Redis key expiration.

## 4. Current Focus: Automatic Nightly Digests

We are implementing a system to summarize conversations, update user profiles, and reset history nightly (user's local 3 AM).

### Logic Requirements
1.  **Timezone Awareness**:
    -   Use `subscriber.profile.timezone` to calculate local time.
    -   Scheduler should run hourly/daily and check who is at "3 AM".
2.  **Digest Creation**:
    -   Condition: Active conversation (>5 messages).
    -   Action: Call `DigestService` to analyze chat.
    -   **Improvements**:
        -   **Vocabulary Extraction**: Extract new words to `subscriber.languages[].vocabulary`.
        -   **Deficiency Tracking**: Update `areasOfStruggle` and `deficiencies`.
        -   **Next Session Seed**: Generate a "context hook" for the *next* conversation start (e.g., "Last time we practiced past tense...").
3.  **History Cleanup**:
    -   After digest is created and saved, **CLEAR** the LangGraph checkpoint (`languageBuddyAgent.clearConversation`).
    -   Keep system prompts/essential context, but wipe the chat buffer.
4.  **Silent User Fallback**:
    -   If user hasn't replied in >48h, schedule a gentle re-engagement message based on previous digest/memos.

### Key Files for Digest Task
-   `backend/src/services/digest-service.ts`: Logic for generating digests.
-   `backend/src/services/scheduler-service.ts`: Where the cron/check logic goes.
-   `backend/src/types/index.ts`: Update Subscriber model if needed (e.g., for tracking `lastDigestAt`).

## 5. Known Issues & Watchlist
-   **Throttling**: Logic for trial vs. premium (1 msg/day) is fragile. Check `SubscriberService.shouldThrottle()`.
-   **Timezones**: Day boundaries for throttling and digests can be tricky. Always use `luxon` and the user's timezone.
-   **Stripe**: Webhook handling needs robust testing.

## 6. Conventions
-   **Output**: Use `markdownToWhatsApp` formatter.
-   **Prompts**: `backend/src/util/system-prompts.ts`.
-   **Tools**: Always define schemas with Zod.
-   **Logs**: Use structured logging (Pino).

## 7. Next Steps / Recommendations (Gemini's List)
-   [ ] **Implement Scheduler**: Create the 3 AM check loop in `SchedulerService`.
    -   *Requirement*: Add Unit tests for timezone calculation.
-   [ ] **Conversation Reset**: Ensure `clearConversation` works without breaking the user's *next* message handling.
    -   *Requirement*: Add Integration test for state clearing.
-   [ ] **Deficiency Practice**: Ensure the `DigestService` explicitly prioritizes identified deficiencies for the *next* day's system prompt.