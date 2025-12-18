# Task: Refactor Agent Architecture & Implement Feedback Subgraph

## Context
We are migrating `LanguageBuddyAgent` from a linear `createReactAgent` to a Hierarchical `StateGraph` (Router-Subgraph pattern). This is necessary to handle "inner loops" like Feedback without polluting the main conversation history.

## Objectives
1.  **Define Global State**: Update the agent state to support "modes" (subgraphs).
2.  **Create Feedback Subgraph**: Implement the isolated graph for collecting feedback.
3.  **Refactor Main Agent**: Convert the main agent to use `StateGraph` and route to Feedback when appropriate.

## Detailed Instructions

### 1. Define Agent State
Create/Update the state schema (likely in `agent.types.ts` or similar):
```typescript
interface AgentState {
  messages: BaseMessage[];
  subscriber: Subscriber;
  activeMode: 'conversation' | 'feedback' | 'onboarding'; // default 'conversation'
  // Ephemeral storage for subgraphs
  subgraphState?: {
    messages: BaseMessage[];
    context: Record<string, any>;
  };
}
```

### 2. Implement `src/features/feedback/feedback.graph.ts`
Create a `StateGraph` that:
-   **Input**: `messages` (the main history), `subgraphState` (empty initially).
-   **Nodes**:
    -   `feedback_agent`: A specialized LLM node (or simple chain) that asks the user for feedback details. It should look at `subgraphState.messages` to know where it is in the feedback loop.
    -   `save_feedback`: A tool/node that persists the feedback using `FeedbackService` and generates a **Summary**.
-   **Flow**:
    -   Start -> `feedback_agent` -> User (Wait)
    -   User -> `feedback_agent` -> (If complete) -> `save_feedback` -> End
-   **Output**:
    -   Appends a **Summary Message** to the main `messages`.
    -   Clears `subgraphState`.
    -   Sets `activeMode = 'conversation'`.

### 3. Refactor `LanguageBuddyAgent`
-   Change the constructor to initialize a `StateGraph`.
-   **Nodes**:
    -   `main_agent`: The existing ReAct logic.
    -   `feedback_subgraph`: The compiled graph from step 2.
-   **Router**:
    -   Add a conditional edge: If `state.activeMode === 'feedback'`, go to `feedback_subgraph`. Else `main_agent`.
-   **Tooling**:
    -   Create a tool `startFeedbackSession` available to the `main_agent`.
    -   Effect: Updates `state.activeMode` to `'feedback'`.

## Acceptance Criteria
-   [ ] The Agent uses `StateGraph`.
-   [ ] A user can say "I want to give feedback".
-   [ ] The agent enters a "Feedback Mode" where it asks clarifying questions.
-   [ ] These clarifying questions/answers are **NOT** present in the main conversation history after the session ends.
-   [ ] Only a summary (e.g., "User gave positive feedback regarding X") remains in the main history.
-   [ ] `npm test` passes.
