import { Registry, Gauge, Counter } from 'prom-client';

export const metricsRegistry = new Registry();

// --- 1. Total Subscribers ---
export const totalSubscribers = new Gauge({
  name: 'languagebuddy_subscribers_total',
  help: 'Total number of registered subscribers',
  registers: [metricsRegistry]
});

// --- 2. Active Subscribers (24h) ---
export const activeSubscribers24h = new Gauge({
  name: 'languagebuddy_subscribers_active_24h',
  help: 'Number of subscribers who were active in the last 24 hours',
  registers: [metricsRegistry]
});

// --- 3. Active Conversations (State) ---
// We define "Active Conversation" as subscribers active in the last 30 minutes
export const activeConversations = new Gauge({
  name: 'languagebuddy_conversations_active',
  help: 'Number of currently active conversations (users active in last 30m)',
  registers: [metricsRegistry]
});

// --- 4. Inactive Subscribers (3d) ---
export const inactiveSubscribers3d = new Gauge({
  name: 'languagebuddy_subscribers_inactive_3d',
  help: 'Number of subscribers with no interaction in the last 3 days',
  registers: [metricsRegistry]
});

// --- 5. Errors (7d visualization handled by Grafana via Counter) ---
export const errorCounter = new Counter({
  name: 'languagebuddy_errors_total',
  help: 'Total number of application errors',
  registers: [metricsRegistry],
  labelNames: ['type', 'component'] // e.g., type='exception', component='messaging'
});

// --- 6. Failed Checks ---
export const failedChecksCounter = new Counter({
  name: 'languagebuddy_checks_failed_total',
  help: 'Total number of failed checks (from !check or digest)',
  registers: [metricsRegistry],
  labelNames: ['source'] // e.g., source='user_command', source='digest_audit'
});

// Helper to record errors easily
export const recordError = (type: string, component: string) => {
  errorCounter.inc({ type, component });
};

// Helper to record failed checks
export const recordFailedCheck = (source: string) => {
  failedChecksCounter.inc({ source });
};
