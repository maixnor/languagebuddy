# LanguageBuddy Project Context for Gemini

## 1. Project Overview
**LanguageBuddy** is a WhatsApp-based language learning service. It uses:
- **LangGraph** for stateful conversational agents.
- **OpenAI GPT-4** for intelligence.
- **Redis** for persistent state (conversation history, user profiles).
- **WhatsApp Cloud API** for user interface.
- **TypeScript/Node.js** backend.

## 2. Architecture & Core Patterns

### Feature-Based Architecture (New)
We are migrating from a layered architecture (Services/Tools/Types) to a **Feature-Based Architecture** to improve cohesion and AI navigability.

**Directory Structure (`backend/src/features/`)**:
-   **`subscriber/`** (Migrated): Core user management.
    -   `subscriber.service.ts`: Business logic.
    -   `subscriber.types.ts`: Domain models (`Subscriber`, `Language`).
    -   `subscriber.tools.ts`: LangChain tools.
    -   `subscriber.contracts.ts`: Zod schemas for tools.
    -   `subscriber.utils.ts`: Helper functions.
    -   `subscriber.prompts.ts`: System prompts.
-   **`digest/`** (Migrated): Daily conversation summaries.
-   **`onboarding/`** (Migrated): User onboarding flow.
-   **`feedback/`** (Pending): User feedback collection.
-   **`subscription/`** (Pending): Stripe integration.

### Services & Container
-   **`ServiceContainer`**: Central singleton container initializing all feature services (`backend/src/services/service-container.ts`).
-   **Pattern**: Services still follow `getInstance(redis)` pattern but are located within their feature folders.

### Data Model (Redis)
-   **Conversation State**: `checkpoint:${phone}` (Managed by LangGraph `RedisCheckpointSaver`).
-   **User Profile**: `subscriber:phone:${phone}` (Managed by `SubscriberService`).
-   **Onboarding State**: `onboarding:${phone}` (Managed by `OnboardingService`).

### The Agent (`LanguageBuddyAgent`)
-   **Orchestrator**: `backend/src/agents/language-buddy-agent.ts`.
-   **Thread ID**: The user's phone number.
-   **Tools**: Aggregated from features (e.g., `subscriber.tools.ts`). Agent *must* use tools to access data.

## 3. Development Workflow

### Local Testing (CLI Mode)
**Crucial**: Do not test against live WhatsApp API during dev. Use the CLI simulator.
1.  **Backend**: `cd backend && npm run dev:cli` (Starts server with `USE_LOCAL_CLI_ENDPOINT`).
2.  **Simulator**: `cd backend && npm run cli` (Interactive terminal chat).

### ⚠️ Testing Mandate ⚠️
**Every new feature or bug fix MUST include tests.**
-   **No "blind" coding**: Write the test, watch it fail, implement the fix, watch it pass.
-   **Refactoring**: If you refactor, add tests *before* touching the code to ensure parity.

### Testing Strategy
Within each feature folder (`backend/src/features/<feature_name>/`), we aim for up to three dedicated test files: `feature-name.unit.test.ts`, `feature-name.int.test.ts`, and `feature-name.e2e.test.ts`. This colocation ensures all testing concerns for a feature are kept together.

1.  **Unit Tests** (`*.unit.test.ts`) - **PREFERRED**
    -   **Scope**: Individual functions/methods (business logic).
    -   **Location**: Collocated within the feature folder (e.g., `features/subscriber/subscriber.utils.unit.test.ts`).
    -   **Mocks**: Mock EVERYTHING external.
    -   **Performance**: Must run in <200ms.
    -   **Usage**: `npm test` (runs fast).

2.  **Integration Tests** (`*.int.test.ts`) - **REQUIRED for State/Service Logic**
    -   **Scope**: Service interactions, Redis state persistence.
    -   **Location**: Collocated within the feature folder (e.g., `features/subscriber/subscriber.service.int.test.ts`).
    -   **Mocks**: Real Redis (local/container), MOCK OpenAI/LLM calls.

3.  **E2E Tests** (`*.e2e.test.ts`) - **SPARINGLY**
    -   **Scope**: Full system flow including real OpenAI responses.
    -   **Location**: Collocated within the feature folder (e.g., `features/subscriber/subscriber.e2e.test.ts`).

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
        -   **Next Session Seed**: Generate a "context hook" for the *next* conversation start.
3.  **History Cleanup**:
    -   After digest is created and saved, **CLEAR** the LangGraph checkpoint.
    -   Keep system prompts/essential context, but wipe the chat buffer.

### Key Files for Digest Task (Target for Migration)
-   `backend/src/features/digest/` (New home)
-   `backend/src/services/digest-service.ts` (Old home - to be migrated)
-   `backend/src/services/scheduler-service.ts` (Old home - to be migrated to `features/scheduling/`)

## 5. Known Issues & Watchlist
-   **Throttling**: Logic for trial vs. premium is fragile. Check `SubscriberService.shouldThrottle()`.
-   **Timezones**: Day boundaries for throttling and digests can be tricky.
-   **Stripe**: Webhook handling needs robust testing.
-   **Detailed Bug Hunting**: Refer to [`backend/BUG-HUNTING-TESTS.md`](backend/BUG-HUNTING-TESTS.md) for a comprehensive list of known bugs and their associated test cases. All P0, P1, and P2 bugs have now been addressed and verified.

## 6. Conventions
-   **Structure**: Feature-based (`backend/src/features/`).
-   **Output**: Use `markdownToWhatsApp` formatter.
-   **Tools**: Always define schemas with Zod in `*.contracts.ts`.
-   **Logs**: Use structured logging (Pino).

## 7. Next Steps / Recommendations (Gemini's List)
-   [ ] **Migrate Digest Feature**: Move `DigestService` and related logic to `backend/src/features/digest/`.
-   [ ] **Migrate Onboarding**: Move `OnboardingService` to `backend/src/features/onboarding/`.
-   [ ] **Implement Scheduler**: Create the 3 AM check loop in `features/scheduling/`.
-   [ ] **Conversation Reset**: Ensure `clearConversation` works without breaking the user's *next* message handling.
