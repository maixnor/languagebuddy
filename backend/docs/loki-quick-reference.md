# Quick Reference: Common Loki Queries

This is a quick reference for the most commonly used Loki queries for the LanguageBuddy backend. For comprehensive documentation, see [metrics-and-monitoring.md](./metrics-and-monitoring.md).

## Debug User Issues

### Check user's recent digest activity
```logql
{service="languagebuddy-backend"} 
  | json 
  | phone=~".*1234"  # last 4 digits
  |~ "digest\\."
```

### Find why a digest failed for a user
```logql
{service="languagebuddy-backend"} 
  | json 
  | phone=~".*1234" 
  | operation=~"digest.*error"
  | line_format "{{.timestamp}} {{.operation}}: {{.errorMessage}}"
```

### See conversation history extraction issues
```logql
{service="languagebuddy-backend"} 
  |~ "digest.history.(no_checkpoint|invalid_messages)" 
  | json 
  | line_format "{{.phone}}: {{.operation}} - {{.messagesType}}"
```

## Monitor Performance

### Current digest creation times (p95)
```logql
quantile_over_time(0.95, 
  {service="languagebuddy-backend"} 
    |= "digest.create.success" 
    | json 
    | unwrap durationMs [5m]
)
```

### LLM API latency breakdown
```logql
{service="languagebuddy-backend"} 
  |= "digest.llm.analyze.complete" 
  | json 
  | line_format "{{.llmDurationMs}}ms ({{.tokensUsed}} tokens)"
```

### Slowest operations in last hour
```logql
topk(10,
  max_over_time(
    {service="languagebuddy-backend"} 
      |~ "digest\\." 
      | json 
      | unwrap durationMs [1h]
  ) by (operation)
)
```

## Track Costs

### Token usage per hour
```logql
sum_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.llm.analyze.complete" 
    | json 
    | unwrap tokensUsed [1h]
)
```

### Cost estimation (assuming $0.01 per 1K tokens)
```logql
(
  sum_over_time(
    {service="languagebuddy-backend"} 
      |= "digest.llm.analyze.complete" 
      | json 
      | unwrap tokensUsed [1h]
  ) / 1000
) * 0.01
```

### Input vs Output token distribution
```logql
# Input tokens
sum_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.llm.analyze.complete" 
    | json 
    | unwrap inputTokens [1h]
)

# Output tokens
sum_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.llm.analyze.complete" 
    | json 
    | unwrap outputTokens [1h]
)
```

## Monitor Errors

### Error rate last 15 minutes
```logql
(
  count_over_time(
    {service="languagebuddy-backend"} 
      |~ "digest.*error" [15m]
  )
  /
  count_over_time(
    {service="languagebuddy-backend"} 
      |~ "digest\\." [15m]
  )
) * 100
```

### Top 5 error types
```logql
topk(5,
  sum by (errorName) (
    count_over_time(
      {service="languagebuddy-backend"} 
        |~ "digest.*error" 
        | json [1h]
    )
  )
)
```

### Recent errors with trace IDs for debugging
```logql
{service="languagebuddy-backend"} 
  |~ "digest.*error" 
  | json 
  | line_format "{{.errorMessage}} - Trace: https://grafana.example.com/explore?traceId={{.traceId}}"
```

## Business Analytics

### Digests created per hour
```logql
count_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.create.success" [1h]
)
```

### Average words learned per digest
```logql
avg_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.llm.digest.created" 
    | json 
    | unwrap newWordsCount [1h]
)
```

### Top digest topics
```logql
topk(10,
  sum by (digestTopic) (
    count_over_time(
      {service="languagebuddy-backend"} 
        |= "digest.create.success" 
        | json [24h]
    )
  )
)
```

### Users with most breakthroughs
```logql
topk(10,
  sum by (phone) (
    sum_over_time(
      {service="languagebuddy-backend"} 
        |= "digest.create.success" 
        | json 
        | unwrap breakthroughsCount [24h]
    )
  )
)
```

## Quality Checks

### LLM parse failures
```logql
{service="languagebuddy-backend"} 
  |= "digest.llm.parse.no_json" 
  | json 
  | line_format "Parse failed - Preview: {{.responsePreview}}"
```

### Low-quality digests (few insights)
```logql
{service="languagebuddy-backend"} 
  |= "digest.llm.digest.created" 
  | json 
  | newWordsCount < 3 
  | grammarConceptsCount < 2
  | line_format "Low quality: {{.phone}} - Topic: {{.digestTopic}}"
```

### Message type distribution issues
```logql
{service="languagebuddy-backend"} 
  |= "digest.history.extract.complete" 
  | json 
  | unknownMessages > 0
  | line_format "{{.phone}}: {{.unknownMessages}} unknown messages out of {{.totalMessages}}"
```

## System Health

### Operations with no activity
```logql
# If this returns 0, the operation is not running
count_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.create.success" [1h]
)
```

### Redis checkpoint issues
```logql
count_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.history.no_checkpoint" [10m]
)
```

### Average message processing time per message
```logql
# Total duration / total messages
(
  sum_over_time(
    {service="languagebuddy-backend"} 
      |= "digest.history.extract.complete" 
      | json 
      | unwrap durationMs [1h]
  )
  /
  sum_over_time(
    {service="languagebuddy-backend"} 
      |= "digest.history.extract.complete" 
      | json 
      | unwrap totalMessages [1h]
  )
)
```

## Advanced Queries

### Correlation: Find slow digests and their traces
```logql
{service="languagebuddy-backend"} 
  |= "digest.create.success" 
  | json 
  | durationMs > 30000
  | line_format "Slow digest: {{.durationMs}}ms - User: {{.phone}} - TraceID: {{.traceId}} - Words: {{.newWordsCount}}"
```

### Anomaly detection: Unusual token usage
```logql
{service="languagebuddy-backend"} 
  |= "digest.llm.analyze.complete" 
  | json 
  | tokensUsed > 5000
  | line_format "High token usage: {{.tokensUsed}} - User: {{.phone}} - Messages: {{.messageCount}}"
```

### Learning velocity trend
```logql
sum_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.llm.digest.created" 
    | json 
    | unwrap newWordsCount [1h]
) 
/ 
count_over_time(
  {service="languagebuddy-backend"} 
    |= "digest.llm.digest.created" [1h]
)
```

## Tips

1. **Use `| __error__=""` after `| json`** to filter out parsing errors
2. **Always start with service label**: `{service="languagebuddy-backend"}`
3. **Use `|=` before `| json`** for better performance
4. **Limit time ranges** for expensive aggregations
5. **Use `line_format`** for readable output in Explore view
6. **Capture TraceIDs** for deep-dive debugging in Tempo

## Quick Dashboard Panels

Copy-paste these into Grafana:

### Panel: Digest Success Rate
```
Type: Stat
Query: (count_over_time({service="languagebuddy-backend"} |= "digest.create.success" [5m]) / count_over_time({service="languagebuddy-backend"} |~ "digest.create.(success|error)" [5m])) * 100
Unit: percent (0-100)
```

### Panel: LLM Latency (p95)
```
Type: Graph
Query: quantile_over_time(0.95, {service="languagebuddy-backend"} |= "digest.llm.analyze.complete" | json | unwrap llmDurationMs [5m])
Unit: milliseconds
```

### Panel: Recent Errors
```
Type: Logs
Query: {service="languagebuddy-backend"} |~ "digest.*error" | json
Limit: 100
```
