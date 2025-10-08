import pino from 'pino';
import { getTraceContext } from './tracing';

// Pino mixin to automatically inject trace context into all logs
const traceMixin = () => {
  const traceContext = getTraceContext();
  return traceContext;
};

// Configure Pino logger with tracing support
const createLogger = () => {
  const baseConfig = {
    level: process.env.LOG_LEVEL || 'info',
    // Add trace context to every log automatically
    mixin: traceMixin,
  };
  
  // Only use pretty printing in development
  const isDevelopment = process.env.ENVIRONMENT?.toLowerCase() !== 'production';
  
  if (isDevelopment) {
    return pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          // Show trace context in development for debugging
          messageFormat: '{traceId} {msg}'
        }
      }
    });
  } else {
    // Production: use structured JSON logging without colors
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
