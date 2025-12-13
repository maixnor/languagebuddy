import { Registry, Gauge, Counter } from 'prom-client';

export const metricsRegistry = new Registry();

// --- I. Subscriber Lifecycle & Growth ---
export const subscribersNewDailyTotal = new Counter({
  name: 'languagebuddy_subscribers_new_daily_total',
  help: 'Total number of new subscribers acquired daily',
  registers: [metricsRegistry]
});

// --- II. Monetization & Value (Paid vs. Free) ---
export const subscribersPremiumTotal = new Gauge({
  name: 'languagebuddy_subscribers_premium_total',
  help: 'Total number of active premium subscribers',
  registers: [metricsRegistry]
});

export const subscribersTrialTotal = new Gauge({
  name: 'languagebuddy_subscribers_trial_total',
  help: 'Total number of subscribers currently in their trial period',
  registers: [metricsRegistry]
});

export const subscribersFreeThrottledTotal = new Gauge({
  name: 'languagebuddy_subscribers_free_throttled_total',
  help: 'Total number of free tier subscribers subject to throttling limits',
  registers: [metricsRegistry]
});

export const conversionsTrialToPremiumTotal = new Counter({
  name: 'languagebuddy_conversions_trial_to_premium_total',
  help: 'Number of trial users who converted to premium',
  registers: [metricsRegistry]
});

export const throttledMessageBlocksTotal = new Counter({
  name: 'languagebuddy_throttled_message_blocks_total',
  help: 'Number of messages blocked due to free-tier throttling limits',
  registers: [metricsRegistry]
});

// --- III. Engagement Quality ---
export const conversationMessagesTotal = new Counter({
  name: 'languagebuddy_conversation_messages_total',
  help: 'Total number of messages exchanged in conversations (user and AI)',
  registers: [metricsRegistry],
  labelNames: ['sender_type', 'subscriber_type']
});

export const conversationDurationSecondsTotal = new Counter({
  name: 'languagebuddy_conversation_duration_seconds_total',
  help: 'Total cumulative seconds spent in conversations',
  registers: [metricsRegistry]
});

export const userCommandsExecutedTotal = new Counter({
  name: 'languagebuddy_user_commands_executed_total',
  help: 'Total number of times specific user commands are invoked',
  registers: [metricsRegistry],
  labelNames: ['command']
});

// --- IV. System & Data Quality ---
export const checksExecutedTotal = new Counter({
  name: 'languagebuddy_checks_executed_total',
  help: 'Total number of AI response checks performed',
  registers: [metricsRegistry]
});

export const digestsAttemptedTotal = new Counter({
  name: 'languagebuddy_digests_attempted_total',
  help: 'Total number of digest creation attempts',
  registers: [metricsRegistry]
});

export const digestsFailedTotal = new Counter({
  name: 'languagebuddy_digests_failed_total',
  help: 'Total number of digest creation attempts that failed',
  registers: [metricsRegistry]
});

export const subscriberAnomaliesDetectedHourly = new Gauge({
  name: 'languagebuddy_subscriber_anomalies_detected_hourly',
  help: 'Number of subscriber records found with anomalies during last hourly scan',
  registers: [metricsRegistry]
});

export const redisInconsistenciesDetectedHourly = new Gauge({
  name: 'languagebuddy_redis_inconsistencies_detected_hourly',
  help: 'Number of inconsistencies found in Redis during last hourly scan',
  registers: [metricsRegistry]
});

// --- Existing Metrics ---
export const totalSubscribers = new Gauge({
  name: 'languagebuddy_subscribers_total',
  help: 'Total number of registered subscribers',
  registers: [metricsRegistry]
});

export const activeSubscribers24h = new Gauge({
  name: 'languagebuddy_subscribers_active_24h',
  help: 'Number of subscribers who were active in the last 24 hours',
  registers: [metricsRegistry]
});

export const activeConversations = new Gauge({
  name: 'languagebuddy_conversations_active',
  help: 'Number of currently active conversations (users active in last 30m)',
  registers: [metricsRegistry]
});

export const inactiveSubscribers3d = new Gauge({
  name: 'languagebuddy_subscribers_inactive_3d',
  help: 'Number of subscribers with no interaction in the last 3 days',
  registers: [metricsRegistry]
});

export const errorCounter = new Counter({
  name: 'languagebuddy_errors_total',
  help: 'Total number of application errors',
  registers: [metricsRegistry],
  labelNames: ['type', 'component'] // e.g., type='exception', component='messaging'
});

export const failedChecksCounter = new Counter({
  name: 'languagebuddy_checks_failed_total',
  help: 'Total number of failed checks (from !check or digest)',
  registers: [metricsRegistry],
  labelNames: ['source'] // e.g., source='user_command', source='digest_audit'
});


// --- Helper Functions ---
export const recordNewSubscriber = () => {
  subscribersNewDailyTotal.inc();
};

export const recordConversion = () => {
  conversionsTrialToPremiumTotal.inc();
};

export const recordThrottledMessage = () => {
  throttledMessageBlocksTotal.inc();
};

export const recordConversationMessage = (senderType: 'user' | 'ai', subscriberType: 'premium' | 'trial' | 'free') => {
  conversationMessagesTotal.inc({ sender_type: senderType, subscriber_type: subscriberType });
};

export const recordUserCommand = (command: string) => {
  userCommandsExecutedTotal.inc({ command });
};

export const recordCheckExecuted = () => {
  checksExecutedTotal.inc();
};

export const recordDigestAttempt = () => {
  digestsAttemptedTotal.inc();
};

export const recordDigestFailure = () => {
  digestsFailedTotal.inc();
};

export const recordError = (type: string, component: string) => {
  errorCounter.inc({ type, component });
};

// Existing helper, renamed for clarity for new additions
export const recordFailedCheckResult = (source: string) => {
  failedChecksCounter.inc({ source });
};

