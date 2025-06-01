import pino from 'pino';
import * as appInsights from 'applicationinsights';

// Initialize Application Insights if connection string is provided
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true)
    .setUseDiskRetryCaching(true)
    .setSendLiveMetrics(false) // Disable live metrics for cost optimization
    .start();
  
  console.log('Application Insights initialized');
} else {
  console.log('Application Insights not configured - APPLICATIONINSIGHTS_CONNECTION_STRING not found');
}

// Configure Pino logger with Application Insights transport
const createLogger = () => {
  const baseConfig = {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label: string) => {
        return { level: label };
      },
    },
  };

  // Add Application Insights transport if available
  if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    return pino({
      ...baseConfig,
      transport: {
        targets: [
          {
            target: 'pino-applicationinsights',
            options: {
              connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
              track: {
                console: true,
                exceptions: true,
                dependencies: true
              }
            },
            level: 'info'
          }
        ]
      }
    });
  }

  // Fallback to console logging if Application Insights is not configured
  return pino(baseConfig);
};

export const logger = createLogger();

// Custom function to track custom events and metrics
export const trackEvent = (name: string, properties?: Record<string, any>, measurements?: Record<string, number>) => {
  if (appInsights.defaultClient) {
    appInsights.defaultClient.trackEvent({
      name,
      properties,
      measurements
    });
  }
  logger.info({ event: name, properties, measurements }, `Custom event: ${name}`);
};

export const trackMetric = (name: string, value: number, properties?: Record<string, any>) => {
  if (appInsights.defaultClient) {
    appInsights.defaultClient.trackMetric({
      name,
      value,
      properties
    });
  }
  logger.info({ metric: name, value, properties }, `Custom metric: ${name} = ${value}`);
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
      timeToSend: '09:00',
      timezone: 'UTC',
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