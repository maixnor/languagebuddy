# SQLite Deployment Plan and Redis Retirement

## Goal
To safely deploy the SQLite-based persistence layer, transition all application data from Redis to SQLite, and subsequently retire Redis instances.

## Strategy
A phased deployment approach will be used to minimize downtime and ensure data integrity.

## Phases

### Phase 1: Pre-Deployment Checks

1.  **Code Completion & Testing**:
    *   Ensure all SQLite migration tasks (infrastructure, subscriber, checkpointer, feedback, throttling) are marked as `done`.
    *   Verify that all unit and integration tests (especially those related to persistence) pass successfully against an in-memory SQLite database.
    *   Ensure `npm run build:full` passes without errors.

2.  **Data Migration Script Readiness**:
    *   Thoroughly test `backend/src/scripts/migrate-redis-to-sqlite.ts` in a staging environment.
    *   Perform a dry-run against a production-like Redis dataset to identify potential issues and estimate migration time.
    *   Confirm the script can successfully connect to both Redis and SQLite.
    *   Ensure the script handles all relevant data types (subscribers, checkpoints, etc.).

3.  **Configuration Preparation**:
    *   Prepare new environment variables or update existing ones to point the application to the SQLite database path (e.g., `DB_PATH=/path/to/languagebuddy.sqlite`).
    *   Ensure Redis connection details are still available for the migration script.

### Phase 2: Deployment and Data Migration

1.  **Application Downtime (Planned Maintenance Window)**:
    *   Communicate planned downtime to users (if applicable).
    *   Gracefully shut down all instances of the LanguageBuddy backend application.

2.  **Data Migration Execution**:
    *   Execute the `backend/src/scripts/migrate-redis-to-sqlite.ts` script.
    *   Monitor its progress and output closely for any errors.
    *   Verify successful completion and data counts (e.g., number of subscribers migrated).

3.  **Configuration Update**:
    *   Update the deployment environment with the new SQLite configuration (e.g., `DB_PATH`).
    *   Remove or comment out Redis-related environment variables from the application's configuration.

4.  **New Code Deployment**:
    *   Deploy the latest version of the backend application code, which is configured to use SQLite.

5.  **Application Startup**:
    *   Start the LanguageBuddy backend application.
    *   Monitor startup logs for any SQLite-related errors.

### Phase 3: Post-Deployment Verification

1.  **Health Checks**:
    *   Perform immediate health checks to ensure the application is running and responsive.
    *   Verify API endpoints are functional.

2.  **Functional Verification**:
    *   Test core user flows (e.g., sending messages, onboarding, subscription management) to confirm data is being read from and written to SQLite correctly.
    *   Check for new subscriber sign-ups and existing user interactions.

3.  **Monitoring & Logging**:
    *   Closely monitor application logs for any errors, especially those related to database operations.
    *   Monitor system performance and resource usage.

4.  **Data Consistency Checks**:
    *   Perform spot checks on user profiles and conversation history to ensure data integrity.
    *   Compare a sample of migrated data in SQLite with the original data in Redis (if Redis is still accessible for read-only checks).

### Phase 4: Redis Retirement

1.  **Stabilization Period**:
    *   Allow a stabilization period (e.g., 24-72 hours) after successful deployment to ensure no critical issues arise with the SQLite backend.

2.  **Decommission Redis**:
    *   Once confident in the stability of the SQLite-based system, gracefully shut down and decommission all Redis instances that were previously used by LanguageBuddy.
    *   Remove any remaining Redis-related configuration or dependencies from the infrastructure.

## Rollback Plan (If Necessary)

*   **Option 1 (Pre-Migration):** If any issue occurs during the data migration script execution, abort the deployment, revert configuration changes, and restart the old application instances pointing to Redis.
*   **Option 2 (Post-Migration, Pre-Redis Decommission):** If issues are found after the new application is live but before Redis is decommissioned, shut down the new application, revert configuration to point back to Redis, and restart the old application. Note: Any data written to SQLite during this period would be lost for users reverting to Redis. This highlights the importance of a short, controlled maintenance window and thorough pre-deployment testing.

## Responsible Parties
*   **[Your Name/Team]**: Responsible for execution and monitoring.
*   **[Stakeholders]**: Responsible for final approval and communication.
