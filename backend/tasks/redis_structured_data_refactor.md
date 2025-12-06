### Prompt: Refactor Redis Persistence to Structured Data

**Goal:** Refactor the backend to use structured Redis data types (RedisJSON or Hashes) instead of storing opaque JSON strings.

**Context:**
Currently, services like `SubscriberService`, `OnboardingService`, and `RedisCheckpointSaver` serialize entire objects using `JSON.stringify` and store them as simple string values in Redis. This approach has several downsides:
*   **Inefficiency:** Reading or updating a single field requires fetching, parsing, modifying, and re-serializing the entire object.
*   **Opaqueness:** Debugging is harder because you can't inspect individual fields easily in the Redis CLI.
*   **Race Conditions:** Full-object updates are more prone to race conditions than atomic field updates (though we have some optimistic locking, granular updates are safer).

**Target Files:**
*   `backend/src/features/subscriber/subscriber.service.ts`
*   `backend/src/features/onboarding/onboarding.service.ts`
*   `backend/src/persistence/redis-checkpointer.ts`
*   `backend/src/features/feedback/feedback.service.ts`

**Implementation Plan:**

1.  **Assess RedisJSON Support:**
    *   Check if the environment's Redis instance supports the RedisJSON module (commands like `JSON.SET`, `JSON.GET`).
    *   *Decision Point:* If RedisJSON is available, it is the **preferred** approach as it handles nested structures (like `subscriber.languages`) natively. If not, fall back to Redis Hashes (`HSET`/`HGET`) and decide on a strategy for nested objects (flattening vs. partial serialization).

2.  **Refactor `SubscriberService`:**
    *   **Current:** `redis.set(key, JSON.stringify(subscriber))`
    *   **New (RedisJSON):** `redis.call('JSON.SET', key, '$', JSON.stringify(subscriber))`
    *   **New (Hash Fallback):** `redis.hset(key, { ...flatFields, languages: JSON.stringify(languages) })`
    *   Update retrieval logic (`getSubscriber`) to parse the response appropriately.
    *   Update partial updates (e.g., updating just `timezone` or `status`) to use atomic commands (`JSON.SET key $.profile.timezone value` or `HSET key profile.timezone value`).

3.  **Refactor `OnboardingService`:**
    *   Migrate `onboarding:${phone}` state storage to structured data.
    *   This state is often flat, making it a good candidate for standard Redis Hashes if RedisJSON is unavailable.

4.  **Refactor `RedisCheckpointSaver`:**
    *   **Current:** `redis.set(checkpointKey, JSON.stringify(checkpoint))`
    *   **New:** Store the LangGraph checkpoint object structurally.
    *   This allows querying specific parts of the conversation state (e.g., just the `messages` array) for debugging or lightweight checks without loading the full context.

5.  **Refactor `FeedbackService`:**
    *   Investigate if `feedback:all` (currently a List of strings) can leverage RedisJSON to store an array of objects, or if it should remain a List of serialized strings (Lists are efficient, so this might be lower priority unless querying by field is needed).

**Migration Strategy:**
*   **Dual Read/Write (Optional but Recommended):** For a safe transition, consider a brief period where code can read both formats (try JSON/Hash first, fall back to String) or run a migration script to convert existing keys.
*   **Prefixing:** You might want to use new key prefixes (e.g., `subscriber:v2:...`) to avoid conflicts during development/testing.

**Expected Impact:**
*   **Performance:** faster updates for large user profiles.
*   **Observability:** vastly improved ability to debug user state via Redis CLI (e.g., `JSON.GET subscriber:+12345 $.profile`).
*   **Maintainability:** Cleaner code for partial updates.
