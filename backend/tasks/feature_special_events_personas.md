# Task: Implement Special Events (Persona Swaps)

## Context
We want to support "Special Weekends" where the agent's persona changes drastically (e.g., "Viking Mode"). This adds variety and engagement.

## Objectives
1.  Create an `EventService` to manage event schedules.
2.  Inject event-specific instructions into the System Prompt.

## Detailed Instructions

### 1. Create `src/features/events/event.service.ts`
-   **Config**: Define a hardcoded (or DB-backed) list of events.
    ```typescript
    const EVENTS = [
      {
        id: 'viking_weekend',
        startDate: '2025-05-10T00:00:00Z',
        endDate: '2025-05-12T23:59:59Z',
        systemPromptAddendum: "You are Ragnar, a Viking warrior. Speak with grandeur! Use metaphors about axes and shields!",
        nameOverride: "Ragnar"
      }
    ];
    ```
-   **Methods**:
    -   `getCurrentEvent()`: Returns the active event if `now` is within the window.

### 2. Integrate with `LanguageBuddyAgent`
-   In `generateSystemPrompt` (or where the prompt is constructed):
    -   Call `EventService.getCurrentEvent()`.
    -   If an event is active:
        -   Append the `systemPromptAddendum` to the base prompt.
        -   (Optional) Temporarily override the agent's name in the context.

### 3. CLI Testing Support
-   Since these are time-based, ensure we can "force" an event active during testing (e.g., via an environment variable or a CLI flag `FORCE_EVENT=viking_weekend`).

## Acceptance Criteria
-   [ ] `EventService` correctly identifies if a date falls within an event window.
-   [ ] When an event is active, the System Prompt includes the persona instructions.
-   [ ] The agent adopts the new persona (verified via chat).
-   [ ] Normal behavior resumes after the event window ends.
