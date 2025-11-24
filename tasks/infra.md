## **Prompt 4 (Revised): Lightweight Developer-Friendly Observability for Solo Development**

### Task: Add practical logging, simple metrics, and developer dashboards that actually help you debug and improve features without complex infrastructure

**Context:**
As a solo developer, you need observability that helps you understand what's working and what's broken WITHOUT spending weeks setting up infrastructure. You need quick answers to questions like "Is the digest system working?", "Are users learning?", "Why did that conversation fail?" Focus on actionable insights with minimal overhead.

**Current State:**
- Basic Pino logging exists
- OpenTelemetry tracing configured but underutilized
- No easy way to see what's happening across users
- Debugging requires digging through Redis manually (`just checkpoint`)
- No visibility into learning outcomes or feature effectiveness

**Implementation Requirements:**

### 1. **Enhanced Structured Logging** (Minimal Changes to Existing Code)

Add consistent event-based logging that you can easily grep/search:

```typescript
// In key locations, add structured logs that tell a story:

// Conversation lifecycle
logger.info({ 
  event: 'conversation_started',
  phone_last4: phone.slice(-4),
  language: language.languageName,
  level: language.overallLevel,
  has_deficiencies: (language.deficiencies?.length || 0) > 0
});

logger.info({
  event: 'conversation_ended',
  phone_last4: phone.slice(-4),
  duration_minutes: Math.round(duration / 60),
  message_count: messageCount
});

// Learning events
logger.info({
  event: 'digest_created',
  phone_last4: phone.slice(-4),
  new_words: digest.vocabulary.newWords.length,
  struggles: digest.areasOfStruggle.length,
  breakthroughs: digest.keyBreakthroughs.length
});

logger.info({
  event: 'deficiency_practiced',
  phone_last4: phone.slice(-4),
  deficiency: deficiency.type,
  language: language.languageName
});
```

### 2. **Simple Daily Digest for Developer** (Reuse Existing WhatsApp)

Create a script that sends YOU a daily WhatsApp message with key stats:

**New file:** `backend/src/scripts/daily-dev-digest.ts`

```typescript
// Runs via cron daily at 8 AM your time
// Sends message to YOUR phone number with:

📊 LanguageBuddy Daily Report
━━━━━━━━━━━━━━━━━━
👥 Users: 12 total (8 active today)
💬 Conversations: 23 today
📝 Digests created: 8 last night
💰 Revenue: 2 premium ($40 MRR)
⚠️ Issues: 1 digest failure

Top 3 deficiencies practiced:
1. Past tense (5 users)
2. Articles (3 users)
3. Pronunciation (2 users)
```

Add to scheduler service or separate cron job. Uses existing WhatsApp integration, sends to your configured admin phone number.

### 3. **Redis Debugging Tools** (Better than `just checkpoint`)

**New file:** `backend/src/scripts/debug-user.ts`

```bash
# Quick CLI tool for common debug tasks
npm run debug:user -- --phone=+123456789

# Shows:
# - User profile (formatted nicely)
# - Current conversation state
# - Recent digests (last 3)
# - Deficiencies and when last practiced
# - Subscription status and trial days remaining
# - Last 5 log events for this user
```

**New file:** `backend/src/scripts/system-health.ts`

```bash
# Quick system health check
npm run health-check

# Shows:
# - Redis connection: ✓
# - OpenAI API: ✓
# - WhatsApp API: ✓
# - Stripe API: ✓
# - Active conversations: 5
# - Digests pending: 2
# - Users needing re-engagement: 3
```

### 4. **Grafana Dashboard** (NixOS-Hosted)

**New endpoint:** routes.ts - `/api/admin/metrics` (protected by simple token auth, exposes metrics for Grafana)

Set up Grafana on NixOS host to visualize application metrics:

**Dashboard Panels:**

- **Last 7 Days Time Series:**
  - Users active per day
  - Conversations per day
  - Digests created per day

- **Current Status Panel:**
  - Total Users
  - Active Today
  - Premium subscribers (percentage)
  - Trial Ending Soon

- **Activity Stream** (Loki logs):
  - Recent digest creations
  - Conversation starts/ends
  - Trial warnings
  - Error events

- **Top Deficiencies This Week:**
  - Bar chart of deficiency practice counts

- **System Health Panel:**
  - Redis response time (avg)
  - OpenAI response time (avg)
  - Digest success rate
  - Error count

Dashboard auto-refreshes every 30 seconds. Data read from Redis metrics and Loki logs.

### 5. **Useful Log Queries** (Documentation)

**New file:** `backend/docs/debugging-cookbook.md`

```bash
# Common debugging scenarios using journalctl and Loki

# Find all digest failures today
journalctl -u languagebuddy-backend -S today | grep "digest" | grep "error"

# Track a specific user's journey
journalctl -u languagebuddy-backend -S today | grep "***1234"

# See all conversations started today
journalctl -u languagebuddy-backend -S today | grep "conversation_started"

# Find users who got throttled
journalctl -u languagebuddy-backend | grep "throttled"

# Check digest creation timing
journalctl -u languagebuddy-backend -S today | grep "digest_created" | awk '{print $1}' | sort | uniq -c

# Tail logs in real-time
journalctl -u languagebuddy-backend -f

# View logs from Grafana/Loki
# Use Grafana Explore tab with LogQL queries like:
# {job="languagebuddy-backend"} |= "error"
# {job="languagebuddy-backend"} |= "conversation_started" | json
```

### 6. **Feature Validation Helpers**

Simple functions you call manually in development to check if features work:

**New file:** `backend/src/scripts/validate-features.ts`

```bash
# Manually validate each feature
npm run validate:deficiencies
# Checks: Are deficiencies being recorded? Being practiced? Updating lastPracticedAt?

npm run validate:digests
# Checks: Are digests creating on schedule? Are profiles being updated? Any failures?

npm run validate:timestamps
# Checks: Do all messages have timestamps? Are gaps being calculated correctly?

npm run validate:throttling
# Checks: Trial user limits working? Premium users unlimited? Day counting accurate?
```

Each script runs checks and prints clear ✓ or ✗ with explanations.

### 7. **Lightweight Metrics** (Redis-based, No Prometheus)

Store simple daily metrics in Redis for quick access:

```typescript
// Increment counters throughout the day
redis.incr('metrics:2025-11-18:conversations')
redis.incr('metrics:2025-11-18:digests_created')
redis.incr('metrics:2025-11-18:deficiencies_practiced')
redis.hincrby('metrics:2025-11-18:deficiencies', 'past_tense', 1)

// Keys expire after 30 days automatically
redis.expire('metrics:2025-11-18:conversations', 2592000)
```

Read by admin dashboard and daily digest script. Simple, no extra infrastructure.

### 8. **Error Notification** (WhatsApp Instead of PagerDuty)

Send yourself a WhatsApp message when critical errors occur:

```typescript
// In error handlers
if (criticalError) {
  logger.error({ err: error }, "Critical error occurred");
  
  // Send yourself a WhatsApp message
  await whatsappService.sendMessage(
    config.adminPhoneNumber,
    `🚨 Critical Error\n\n${error.message}\n\nUser: ${phone}\nCheck logs for details`
  );
}
```

Configure what counts as "critical" - digest failures, payment issues, API outages.

### 9. **Testing Checklist** (Manual but Systematic)

**New file:** `backend/TESTING-CHECKLIST.md`

```markdown
## Before Deploying New Feature

### Weakness Integration
- [ ] Chat with test user, confirm deficiency mentioned in greeting
- [ ] Check logs for `deficiency_practiced` events
- [ ] Run `npm run validate:deficiencies`
- [ ] Verify lastPracticedAt updates in Redis

### Digest System  
- [ ] Manually trigger digest: `npm run digest:create -- --phone=+123`
- [ ] Check profile updated with memos
- [ ] Verify conversation cleared after digest
- [ ] Run `npm run validate:digests`

### Time Awareness
- [ ] Send messages with different time gaps
- [ ] Check logs for time_gap calculations
- [ ] Verify natural conversation ending
- [ ] Run `npm run validate:timestamps`

### After Deploy
- [ ] Check admin dashboard for errors
- [ ] Monitor next daily digest message
- [ ] Spot check 2-3 user conversations
- [ ] Run `npm run health-check`
```

### 10. **Implementation Priority**

**Week 1 - Quick Wins:**
- Enhanced structured logging (1-2 hours)
- Daily dev digest WhatsApp message (2-3 hours)
- Simple health check script (1 hour)

**Week 2 - Debugging Tools:**
- `debug-user` CLI tool (3-4 hours)
- Feature validation scripts (2-3 hours)
- Testing checklist doc (1 hour)

**Week 3 - NixOS Observability Stack:**
- Configure Grafana and Loki in NixOS (2-3 hours)
- Set up Promtail for log shipping (1 hour)
- Create Grafana dashboards (3-4 hours)
- Redis-based metrics (2 hours)

**NixOS Deployment Notes:**
- Use existing `just deploy-prod` workflow - adds Grafana/Loki services to systemd
- Grafana runs behind nginx reverse proxy (same host as backend)
- Loki stores logs locally on disk (30-day retention)
- No Docker needed - all services managed via systemd/NixOS
- Metrics endpoint (`/api/admin/metrics`) integrated with existing backend

**Expected Impact:**
- **See issues within minutes** - Daily digest + WhatsApp alerts catch problems fast
- **Debug 5x faster** - `debug-user` script shows everything about a user instantly
- **Confidence in features** - Validation scripts confirm things work before deploy
- **Data-driven decisions** - Grafana dashboards show what's actually improving learning
- **No Docker complexity** - Everything managed via NixOS declarative config
- **Unified observability** - Logs (Loki) + metrics (Redis) + dashboards (Grafana) in one place

**Success Metrics:**
- You catch digest failures same-day instead of week-later
- Debugging a user issue takes <5 minutes instead of 30
- You know trial → premium conversion rate without manual counting
- Feature launches have validation checklist, not crossed fingers
- Daily digest message is useful enough you read it every morning
- Grafana dashboards load in <2 seconds with full week of data

**Total Implementation Time:** ~18-25 hours spread over 2-3 weeks, mostly scripting and NixOS config. No Docker containers to manage. Uses NixOS declarative approach. Practical for solo developer.