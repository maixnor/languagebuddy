# Metrics and Monitoring Guide

This document outlines useful metrics, queries, and dashboard configurations for monitoring the LanguageBuddy backend using Loki (logs), Tempo (traces), and Prometheus/Grafana (metrics).

## Table of Contents
- [Logging Strategy](#logging-strategy)
- [Key Metrics to Monitor](#key-metrics-to-monitor)
- [Loki Query Examples](#loki-query-examples)
- [Grafana Dashboard Configurations](#grafana-dashboard-configurations)
- [Alerting Rules](#alerting-rules)

---

## Logging Strategy

All services use structured logging with the following context automatically injected:
- **traceId**: Links logs to distributed traces
- **spanId**: Identifies specific operations within a trace
- **operation**: Semantic operation identifier (e.g., `digest.create.start`)
- **phone**: User identifier (last 4 digits for privacy in production)
- **durationMs**: Operation duration for performance tracking

### Log Levels
- **trace**: Very detailed information for debugging (disabled in production)
- **debug**: Detailed information for development and troubleshooting
- **info**: General informational messages about application flow
- **warn**: Warning messages for potential issues
- **error**: Error messages with full context and stack traces

---

## Key Metrics to Monitor

### 1. Digest Service Metrics

#### Performance Metrics
- **Digest Creation Duration** - Track time to create digests
  - Target: < 30 seconds for p95
  - Alert: > 60 seconds
  
- **LLM Analysis Duration** - Track LLM API call duration
  - Target: < 20 seconds for p95
  - Alert: > 45 seconds
  
- **Conversation History Extraction Duration** - Track Redis checkpoint retrieval
  - Target: < 2 seconds for p95
  - Alert: > 5 seconds

#### Success/Failure Metrics
- **Digest Creation Success Rate** - % of successful digest creations
  - Target: > 95%
  - Alert: < 90%
  
- **LLM Parse Success Rate** - % of successful JSON parsing from LLM
  - Target: > 98%
  - Alert: < 95%
  
- **Checkpoint Retrieval Success Rate** - % of successful checkpoint retrievals
  - Target: > 99%
  - Alert: < 95%

#### Business Metrics
- **Digests Created per Hour** - Track digest creation rate
- **Average Words Learned per Digest** - Track learning velocity
- **Average Grammar Mistakes per Digest** - Track learning challenges
- **User Memos Generated per Digest** - Track personalization quality

#### Token Usage Metrics (LLM)
- **Total Tokens Used per Digest** - Track API costs
- **Input Tokens** - Track conversation size being analyzed
- **Output Tokens** - Track digest generation size
- **Tokens per Dollar** - Cost efficiency

---

## Loki Query Examples

### Digest Service Queries

#### 1. Digest Creation Performance
```logql
{service="languagebuddy-backend"} 
  |= "digest.create.success" 
  | json 
  | __error__="" 
  | unwrap durationMs 
  | quantile_over_time(0.95, [5m]) by (operation)
```

#### 2. Failed Digest Creations
```logql
{service="languagebuddy-backend"} 
  |= "digest.create.error" 
  | json 
  | line_format "{{.phone}} - {{.errorMessage}} ({{.durationMs}}ms)"
```

#### 3. LLM Performance and Cost
```logql
{service="languagebuddy-backend"} 
  |= "digest.llm.analyze.complete" 
  | json 
  | line_format "LLM: {{.llmDurationMs}}ms, Tokens: {{.tokensUsed}} (In: {{.inputTokens}}, Out: {{.outputTokens}})"
```

#### 4. Low-Quality Digests (Few Insights)
```logql
{service="languagebuddy-backend"} 
  |= "digest.llm.digest.created" 
  | json 
  | newWordsCount < 3 
  | grammarConceptsCount < 2
  | line_format "Low quality digest for {{.phone}}: {{.digestTopic}}"
```

#### 5. Digest Creation Rate
```logql
count_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.create.success" [1h]
)
```

#### 6. Top Error Messages
```logql
topk(10,
  sum by (errorMessage) (
    count_over_time(
      {service="languagebuddy-backend"} 
        |~ "digest.*error" 
        | json [1h]
    )
  )
)
```

#### 7. Users with No Conversation History
```logql
{service="languagebuddy-backend"} 
  |= "digest.create.no_history" 
  | json 
  | line_format "{{.phone}} - No history ({{.historyLength}} messages)"
```

#### 8. LLM Parse Failures
```logql
{service="languagebuddy-backend"} 
  |~ "digest.llm.parse.(error|no_json)" 
  | json 
  | line_format "{{.phone}} - Parse issue: {{.operation}} - Preview: {{.responsePreview}}"
```

#### 9. Message Type Distribution
```logql
{service="languagebuddy-backend"} 
  |= "digest.history.extract.complete" 
  | json 
  | line_format "{{.phone}}: Human={{.humanMessages}} AI={{.aiMessages}} Unknown={{.unknownMessages}}"
```

#### 10. Learning Insights by Language
```logql
{service="languagebuddy-backend"} 
  |= "digest.create.success" 
  | json 
  | line_format "{{.learningLanguage}}: Words={{.newWordsCount}} Struggles={{.strugglesCount}} Breakthroughs={{.breakthroughsCount}}"
```

### Correlation with Traces

#### 11. Slow Operations with Trace IDs
```logql
{service="languagebuddy-backend"} 
  |= "digest" 
  | json 
  | durationMs > 30000 
  | line_format "Slow operation {{.operation}}: {{.durationMs}}ms - TraceID: {{.traceId}}"
```

#### 12. Errors with Full Context
```logql
{service="languagebuddy-backend"} 
  |~ "digest.*error" 
  | json 
  | line_format "Error in {{.operation}} - User: {{.phone}} - Message: {{.errorMessage}} - TraceID: {{.traceId}} - Duration: {{.durationMs}}ms"
```

---

## Grafana Dashboard Configurations

### Dashboard 1: Digest Service Overview

**Panels:**

1. **Digest Creation Rate** (Graph)
   - Query: `count_over_time({service="languagebuddy-backend"} |= "digest.create.success" [5m])`
   - Time range: Last 6 hours
   - Visualization: Time series

2. **Success vs Failure Rate** (Stat)
   - Success: `{service="languagebuddy-backend"} |= "digest.create.success"`
   - Failure: `{service="languagebuddy-backend"} |= "digest.create.error"`
   - Visualization: Stat panel with threshold colors

3. **p50/p95/p99 Duration** (Graph)
   - Query: Multiple quantiles of `durationMs` field
   - Visualization: Multi-line graph

4. **Recent Errors** (Logs Panel)
   - Query: `{service="languagebuddy-backend"} |~ "digest.*error" | json`
   - Visualization: Logs panel
   - Limit: Last 50 errors

5. **LLM Token Usage Over Time** (Graph)
   - Query: Extract and sum `tokensUsed` field
   - Visualization: Stacked area chart (input vs output tokens)

6. **Top Users by Digest Count** (Bar Chart)
   - Query: `sum by (phone) (count_over_time(...))`
   - Visualization: Bar gauge

### Dashboard 2: Learning Analytics

**Panels:**

1. **Average Words Learned per Digest** (Stat)
   - Query: `avg_over_time({...} |= "digest.llm.digest.created" | json | unwrap newWordsCount [1h])`
   - Visualization: Stat with trend

2. **Grammar Mistakes Distribution** (Heatmap)
   - Query: Extract `grammarMistakesCount` grouped by time
   - Visualization: Heatmap

3. **Most Common Digest Topics** (Pie Chart)
   - Query: `topk(10, sum by (digestTopic) (...))`
   - Visualization: Pie chart

4. **User Engagement Score** (Time Series)
   - Query: Combine `messagesAnalyzed`, `breakthroughsCount`, etc.
   - Visualization: Multi-series graph

5. **Learning Languages Distribution** (Bar Chart)
   - Query: `sum by (learningLanguage) (count_over_time(...))`
   - Visualization: Horizontal bar chart

### Dashboard 3: Performance & Costs

**Panels:**

1. **LLM API Latency** (Graph)
   - Query: `{...} |= "digest.llm.analyze.complete" | json | unwrap llmDurationMs`
   - Visualization: Time series with quantiles

2. **Token Cost Estimation** (Stat)
   - Query: Calculate costs based on token usage
   - Visualization: Stat panel with cost/hour

3. **Cache Hit Rate** (Stat)
   - Query: Compare checkpoint retrievals with/without data
   - Visualization: Percentage stat

4. **Error Rate by Operation** (Bar Chart)
   - Query: `sum by (operation) (count_over_time({...} |~ "error"))`
   - Visualization: Bar chart

5. **Response Size Distribution** (Histogram)
   - Query: `{...} |= "digest.llm.analyze.complete" | json | unwrap responseLength`
   - Visualization: Histogram

---

## Alerting Rules

### Critical Alerts

#### 1. High Error Rate
```yaml
alert: DigestServiceHighErrorRate
expr: |
  (
    count_over_time({service="languagebuddy-backend"} |= "digest.create.error" [5m])
    /
    count_over_time({service="languagebuddy-backend"} |~ "digest.create.(success|error)" [5m])
  ) > 0.1
for: 5m
labels:
  severity: critical
annotations:
  summary: "Digest service error rate above 10%"
  description: "{{ $value | humanizePercentage }} of digest creations are failing"
```

#### 2. Slow Digest Creation
```yaml
alert: DigestServiceSlowCreation
expr: |
  quantile_over_time(0.95, 
    {service="languagebuddy-backend"} |= "digest.create.success" 
    | json | unwrap durationMs [10m]
  ) > 60000
for: 10m
labels:
  severity: warning
annotations:
  summary: "p95 digest creation time > 60s"
  description: "Digest creation is slow: {{ $value }}ms"
```

#### 3. LLM Parse Failures
```yaml
alert: DigestLLMParseFailures
expr: |
  count_over_time(
    {service="languagebuddy-backend"} |= "digest.llm.parse.no_json" [5m]
  ) > 5
for: 5m
labels:
  severity: warning
annotations:
  summary: "Multiple LLM parse failures detected"
  description: "{{ $value }} parse failures in last 5 minutes"
```

#### 4. No Digests Created
```yaml
alert: DigestServiceNoActivity
expr: |
  count_over_time(
    {service="languagebuddy-backend"} |= "digest.create.success" [1h]
  ) == 0
for: 1h
labels:
  severity: warning
annotations:
  summary: "No digests created in last hour"
  description: "Digest service may be down or not receiving requests"
```

### Warning Alerts

#### 5. High Token Usage
```yaml
alert: DigestServiceHighTokenUsage
expr: |
  sum_over_time(
    {service="languagebuddy-backend"} |= "digest.llm.analyze.complete" 
    | json | unwrap tokensUsed [1h]
  ) > 500000
for: 1h
labels:
  severity: warning
annotations:
  summary: "High LLM token usage detected"
  description: "{{ $value }} tokens used in last hour"
```

#### 6. Redis Connection Issues
```yaml
alert: DigestServiceRedisIssues
expr: |
  count_over_time(
    {service="languagebuddy-backend"} |= "digest.history.no_checkpoint" [10m]
  ) > 10
for: 5m
labels:
  severity: warning
annotations:
  summary: "Multiple Redis checkpoint retrieval failures"
  description: "{{ $value }} checkpoint failures in 10 minutes"
```

---

## Best Practices

### 1. Query Optimization
- Use label filters first: `{service="languagebuddy-backend"}` before `|=`
- Use `|= "string"` for fast text matching before JSON parsing
- Limit time ranges for expensive queries
- Use `__error__=""` to filter out parse errors

### 2. Log Correlation
- Always include `traceId` to correlate logs with traces in Tempo
- Use consistent `operation` names across services
- Include `phone` for user-specific debugging
- Add `durationMs` for performance tracking

### 3. Cost Management
- Monitor token usage trends to predict costs
- Alert on unusual spikes in API calls
- Track cost per user/digest for ROI analysis

### 4. Performance Tuning
- Set up percentile alerts (p95, p99) for latency
- Track slow operations with trace IDs for deep analysis
- Monitor Redis performance separately

### 5. Data Privacy
- Avoid logging full phone numbers in production
- Don't log sensitive user data (full names, addresses)
- Redact PII from error messages
- Use hashed user IDs where possible

---

## Useful Label Filters

```logql
# All digest-related operations
{service="languagebuddy-backend"} |~ "digest\\."

# Only errors
{service="languagebuddy-backend"} | json | level="error"

# Specific user (last 4 digits)
{service="languagebuddy-backend"} | json | phone=~".*1234"

# Operations taking > 30 seconds
{service="languagebuddy-backend"} | json | durationMs > 30000

# Successful operations with high learning output
{service="languagebuddy-backend"} |= "digest.create.success" | json | newWordsCount > 10
```

---

## Future Metrics to Implement

These metrics are documented here but not yet implemented in code:

1. **User Retention Metrics**
   - Days since last digest
   - Streak calculations
   - Churn prediction accuracy

2. **Learning Progress Metrics**
   - Skill level changes over time
   - Deficiency reduction rate
   - Objective completion rate

3. **System Health Metrics**
   - Redis connection pool stats
   - LLM API rate limits
   - Memory usage per digest

4. **Business Metrics**
   - Cost per active user
   - Premium conversion rate
   - Average session duration

5. **Quality Metrics**
   - Feedback sentiment scores
   - Digest accuracy (if user feedback available)
   - Personalization effectiveness
