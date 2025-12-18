# Task: Implement Survey Feedback Flow

## Context
The Feedback feature currently supports "Rapid" feedback (Task 1). We need to extend this to support structured "Surveys" (e.g., Monthly check-ins with specific questions).

## Dependencies
-   Task 1 (Feedback Subgraph) must be complete.

## Detailed Instructions

### 1. Define Survey Configuration
Create a structure to define survey questions.
```typescript
interface SurveyConfig {
  id: string;
  questions: string[]; // e.g. ["Do you prefer Voice or Text?", "Rate us 1-10"]
}
```
*Ideally, this config might live in a `feedback.config.ts` or be fetched dynamically.*

### 2. Update `FeedbackGraph`
-   **State**: Update `subgraphState` to include `feedbackType` ('rapid' | 'survey') and `surveyProgress` (current question index).
-   **Logic**:
    -   If `type === 'rapid'`: Use existing flow (Open-ended "What's wrong?").
    -   If `type === 'survey'`:
        -   Look up the current question set.
        -   Ask Question[i].
        -   Store Answer[i].
        -   Increment i.
        -   If i >= questions.length, go to `save_feedback`.

### 3. Update Tools & Trigger
-   Update `startFeedbackSession` tool to accept an argument: `type: 'rapid' | 'survey'`.
-   (Optional) If a `SchedulerService` exists, add a trigger to call this tool on a schedule (e.g., first Monday of the month). *For this task, manual triggering via the CLI/Tool is sufficient proof.*

## Acceptance Criteria
-   [ ] The `startFeedbackSession` tool accepts a `type` parameter.
-   [ ] 'rapid' type preserves original behavior.
-   [ ] 'survey' type iterates through a defined list of questions.
-   [ ] All survey answers are saved (likely as a JSON blob in the `feedback` table or a new `surveys` table).
-   [ ] Summary message reflects that a survey was completed.
