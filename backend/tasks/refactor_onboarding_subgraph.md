# Task: Implement Onboarding Subgraph

## Context
Following the architecture refactor (Task 1), we need to move the implicit onboarding logic into a dedicated **Onboarding Subgraph**. This ensures that the messy "What is your name?" interaction doesn't clutter the long-term history of the user.

## Dependencies
-   Task 1 (Architecture Refactor) must be complete (Agent using `StateGraph`).

## Detailed Instructions

### 1. Implement `src/features/onboarding/onboarding.graph.ts`
Create a `StateGraph` for onboarding.
-   **State**: Needs to track collected fields: `name`, `timezone`, `nativeLanguage`, `targetLanguage`, `currentSkillLevel`.
-   **Nodes**:
    -   `profile_collector`: Iteratively asks for missing fields. Validates answers (e.g., checks valid Timezone).
    -   `skill_assessment`: Once profile is complete, engages in a short conversation to gauge level (A1-C2). Ramps up difficulty until user struggles.
    -   `finalize_onboarding`:
        -   Calls `SubscriberService.createSubscriber()`.
        -   Generates a summary message.
-   **Flow**:
    -   Start -> `profile_collector`
    -   `profile_collector` -> (if complete) -> `skill_assessment`
    -   `skill_assessment` -> (if assessment done) -> `finalize_onboarding` -> End

### 2. Update Main Router
In `LanguageBuddyAgent`:
-   Add a check at the start of the flow (or a "Guard" node):
    -   **IF** `state.subscriber` is NULL/Undefined (or checks DB and finds nothing):
    -   **THEN** Route to `onboarding_subgraph`.
    -   **ELSE** Proceed to `main_agent` or checks `activeMode`.

### 3. Cleanup
-   Remove the old "Implicit" onboarding logic (e.g., `getMissingProfileFieldsReflective` checks in the system prompt) since the Subgraph now handles this explicitly.

## Acceptance Criteria
-   [ ] A new phone number (simulated user) is automatically routed to the Onboarding flow.
-   [ ] The agent collects Name, Timezone, and Languages.
-   [ ] The agent performs a skill assessment.
-   [ ] A `Subscriber` record is created in SQLite.
-   [ ] Upon completion, the detailed onboarding chat is discarded, replaced by a summary.
-   [ ] The user is seamlessly transitioned to the Main Agent.
