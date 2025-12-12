import pino from 'pino';
import { getTraceContext } from './tracing';
import { recordError } from './metrics';

// Pino mixin to automatically inject trace context into all logs
const traceMixin = () => {
  const traceContext = getTraceContext();
  return traceContext;
};

// Configure Pino logger with tracing support
const createLogger = () => {
  const baseConfig: any = {
    level: process.env.LOG_LEVEL || 'info',
    // Add trace context to every log automatically
    mixin: traceMixin,
    hooks: {
      logMethod(inputArgs: any[], method: any, level: number) {
        // Level 50 is ERROR, 60 is FATAL
        if (level >= 50) {
          // Record error metric without blocking logging
          try {
             recordError('log_error', 'application');
          } catch (e) {
             // Ignore metric errors to avoid crash loop
          }
        }
        return method.apply(this, inputArgs);
      }
    }
  };

  // Conditionally add error serializer to suppress stack traces
  if (process.env.SUPPRESS_LOG_STACK_TRACES === 'true') {
    baseConfig.serializers = {
      err: (error) => {
        if (error instanceof Error) {
          const { stack, ...rest } = error;
          return rest;
        }
        return error;
      },
    };
  }
  
  // Determine logging format based on environment
  // We want structured JSON logs in 'production', 'staging', and 'test' environments for Grafana/Loki indexing.
  const environment = process.env.ENVIRONMENT?.toLowerCase() || 'production';
  const useStructuredLogging = ['production', 'staging', 'test'].includes(environment);
  
  if (!useStructuredLogging) {
    return pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          // Show trace context in development for debugging
          messageFormat: '{traceId} {msg}',
        }
      }
    });
  } else {
    // Production/Test/Staging: use structured JSON logging without colors
    return pino({
      ...baseConfig,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
};

export const logger = createLogger();

// Keep the existing tracking functions for compatibility
export const trackEvent = (name: string, properties?: Record<string, any>, measurements?: Record<string, number>) => {
  logger.trace({ event: name, properties, measurements }, `Custom event: ${name}`);
};

export const trackMetric = (name: string, value: number, properties?: Record<string, any>) => {
  logger.trace({ metric: name, value, properties }, `Custom metric: ${name} = ${value}`);
};
