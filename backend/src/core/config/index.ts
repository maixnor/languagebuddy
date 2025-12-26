import pino from 'pino';
import { getTraceContext } from '../observability/tracing';
import path from 'path';

// Configure Pino logger
let _transport: any; // To hold the pino-pretty transport stream

const createLogger = () => {
  const baseConfig = {
    level: process.env.LOG_LEVEL || 'info',
    // Automatically inject trace context into every log
    mixin: () => getTraceContext(),
    // Ensure levels are strings (e.g., "info", "error") for better compatibility with Grafana/Loki
    formatters: {
      level: (label: string) => {
        return { level: label };
      },
    },
  };

  // Only use pretty printing in development, unless explicitly disabled
  const isDevelopment = process.env.ENVIRONMENT !== 'production';
  const forceJson = process.env.LOG_FORMAT?.toLowerCase() === 'json';

  if (isDevelopment && !forceJson) {
    _transport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    })
    return pino({
      ...baseConfig,
    }, _transport);
  } else {
    // Production: use structured JSON logging without colors
    return pino({
      ...baseConfig,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
};

export const closeLoggerTransport = () => {
  if (_transport) {
    _transport.end();
  }
}

export const logger = createLogger();

export const trackEvent = (name: string, properties?: Record<string, any>, measurements?: Record<string, number>) => {
  logger.trace({ event: name, properties, measurements }, `Custom event: ${name}`);
};

export const trackMetric = (name: string, value: number, properties?: Record<string, any>) => {
  logger.trace({ metric: name, value, properties }, `Custom metric: ${name} = ${value}`);
};

export const getConfig = () => ({
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    model: process.env.OPENAI_MODEL_NAME!,
    maxTokens: 1000,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY!,
    model: process.env.GEMINI_MODEL_NAME!,
    maxTokens: 1000,
  },
  whatsapp: {
    token: process.env.WHATSAPP_ACCESS_TOKEN!,
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
    appSecret: process.env.WHATSAPP_APP_SECRET!,
  },
  telegram: {
    token: process.env.TELEGRAM_TOKEN!,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET!,
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  },
  subscription: {
    trialDays: parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS || '7', 10),
  },
  test: {
    phoneNumbers: process.env.TEST_PHONE_NUMBERS ? process.env.TEST_PHONE_NUMBERS.split(',') : [],
    skipStripeCheck: process.env.SKIP_STRIPE_CHECK === 'true',
  },
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'languagebuddy.sqlite'),
  features: {
    dailyMessages: {
      enabled: true,
      defaultWindows: {
        morning: { start: '07:00', end: '10:00' },
        midday: { start: '11:00', end: '14:00' },
        evening: { start: '18:00', end: '21:00' },
      },
      fuzzinessMinutes: 30
    },
    feedback: {
      collectionProbability: 0.1, // 10% chance to ask for feedback
      maxFeedbackPerDay: 2,
    },
    freeUser: {
      retainConversationHistory: false, // Clear at night
      maxDailyMessages: null, // No limit on message count
      allowedFeatures: ['chat', 'basic_commands'],
      restrictedFeatures: ['voice', 'images', 'premium_commands'],
    },
    premiumUser: {
      retainConversationHistory: true,
      maxDailyMessages: null,
      allowedFeatures: ['all'],
      restrictedFeatures: [],
    },
    nighttime: {
      digestCreationTime: '03:00',
      conversationResetTime: '03:00',
      timezone: 'UTC',
    }
  },
  server: {
    port: process.env.PORT || 8080,
  },
  publicBaseUrl: (() => {
    const url = process.env.PUBLIC_BASE_URL;
    if (!url) {
      throw new Error('PUBLIC_BASE_URL environment variable not set. This is required for webhooks (e.g., Telegram).');
    }
    return url;
  })(),
  fallbackTimezone: 'UTC',
});

// Lazy-loaded config that gets the fresh env vars when accessed
let _config: ReturnType<typeof getConfig> | null = null;

export const config = new Proxy({} as ReturnType<typeof getConfig>, {
  get(target, prop) {
    if (!_config) {
      _config = getConfig();
    }
    return (_config as any)[prop];
  }
});
