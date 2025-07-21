import pino from 'pino';

// Configure Pino logger
const createLogger = () => {
  const baseConfig = {
    level: process.env.LOG_LEVEL || 'info',
  };
  return pino({
    ...baseConfig,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  });
};

export const logger = createLogger();

export const trackEvent = (name: string, properties?: Record<string, any>, measurements?: Record<string, number>) => {
  logger.trace({ event: name, properties, measurements }, `Custom event: ${name}`);
};

export const trackMetric = (name: string, value: number, properties?: Record<string, any>) => {
  logger.trace({ metric: name, value, properties }, `Custom metric: ${name} = ${value}`);
};

export const config = {
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
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  features: {
    dailyMessages: {
      enabled: true,
      defaultWindows: {
        morning: { start: '07:00', end: '10:00' },
        midday: { start: '11:00', end: '14:00' },
        evening: { start: '18:00', end: '21:00' },
        fuzzinessMinutes: 30
      }
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
  }
};