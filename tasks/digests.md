# Prompt 2: Automatic Nightly Conversation Digest & Reset System
## Task: Implement automatic conversation digest creation, profile updates, and history reset at user's local 3 AM
Context:
Currently conversations grow indefinitely without summarization, context gets lost, and there's no automatic cleanup. The digest system exists but isn't triggered automatically. Users need conversation resets to start fresh while retaining learning progress.

## Current State:

Digest service fully implemented (DigestService) with LLM analysis
Scheduler service has TODOs for digest triggering and history cleanup
Timezone stored in subscriber profile but not used for scheduling
Manual !digest command works but users don't know about it
Conversation history grows unbounded, causing token waste
Implementation Requirements:

## Timezone-Aware Scheduling (scheduler-service.ts):

Add new cron job that runs hourly (or every 30 minutes)
For each subscriber, calculate if it's currently 3 AM in their timezone
Use DateTime.fromISO(subscriber.profile.timezone) for accurate local time
Track last digest date in subscriber metadata to prevent duplicate digests
## Automatic Digest Creation:

Check if user has active conversation (>5 messages)
Call digestService.createConversationDigest(subscriber)
Save digest to subscriber.metadata.digests[] array
Extract user memos and merge with existing profile data
Update deficiencies based on areasOfStruggle from digest
## Profile Updates from Digest:

Parse digest.userMemos and update subscriber.profile.memos
Add new deficiencies from digest.areasOfStruggle and digest.grammar.mistakesMade
Update vocabulary tracking if structure exists
Increment conversation stats (total conversations, messages exchanged)
## Conversation History Cleanup:

After digest is created and saved, clear conversation checkpoint
Call languageBuddyAgent.clearConversation(phone)
Preserve system messages but remove chat history
Log digest summary for observability
Fallback for Silent Users (address bug from todos):

If user hasn't messaged in 2+ days, send gentle re-engagement message
Minimum 2 messages per week even without user replies
Track "last message sent" separately from "last user reply"
## Testing Strategy:

Unit tests: Timezone calculation, 3 AM detection logic, digest scheduling
Integration tests: Full digest → profile update → history cleanup flow with real Redis
E2E tests: Simulate conversation over multiple days, verify digests created correctly
## Expected Impact:

Conversations stay focused with regular resets
Learning progress is continuously tracked and summarized
User profiles get richer with accumulated memos and insights
Reduced token costs from unbounded conversation histories
Users re-engage more consistently with automatic outreach
## Success Metrics:

Digests created within 1 hour of user's 3 AM
90%+ of active users get nightly digest
Average conversation context stays under 4000 tokens
Silent users receive re-engagement message after 2 days
Profile memos grow over time (avg 5+ memos after 2 weeks)