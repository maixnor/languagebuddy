import { logger } from './logging';

// Configure the OpenTelemetry SDK - No-op
export const initializeTracing = () => {
  logger.info('Tracing disabled (Tempo removed)');
  return null;
};

// Helper function to create custom spans for business logic - Pass-through
export const createBusinessSpan = <T>(
  name: string,
  operation: (span: any) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> => {
    // Just execute the operation directly without creating a span
    // Pass a dummy span object that has methods expected by consumers if any
    const dummySpan = {
        setStatus: () => {},
        recordException: () => {},
        end: () => {},
        setAttribute: () => {},
        addEvent: () => {}
    };
    return operation(dummySpan);
};

// Helper to get current trace context for logging - Empty
export const getTraceContext = () => {
  return {};
};

// Helper for conversation-specific spans - Pass-through
export const traceConversation = <T>(
  operation: string,
  phoneNumber: string,
  fn: (span: any) => Promise<T>
): Promise<T> => {
  const dummySpan = {
      setStatus: () => {},
      recordException: () => {},
      end: () => {},
      setAttribute: () => {},
      addEvent: () => {}
  };
  return fn(dummySpan);
};

// Helper for WhatsApp service spans - Pass-through
export const traceWhatsApp = <T>(
  operation: string,
  phoneNumber: string,
  fn: (span: any) => Promise<T>
): Promise<T> => {
  const dummySpan = {
      setStatus: () => {},
      recordException: () => {},
      end: () => {},
      setAttribute: () => {},
      addEvent: () => {}
  };
  return fn(dummySpan);
};

// Helper for OpenAI spans - Pass-through
export const traceOpenAI = <T>(
  operation: string,
  model: string,
  fn: (span: any) => Promise<T>
): Promise<T> => {
  const dummySpan = {
      setStatus: () => {},
      recordException: () => {},
      end: () => {},
      setAttribute: () => {},
      addEvent: () => {}
  };
  return fn(dummySpan);
};

// Enhanced helper to add events to current span - No-op
export const addSpanEvent = (
  name: string,
  attributes?: Record<string, string | number | boolean>
) => {
  // No-op
};

// Helper to add attributes to current span - No-op
export const setSpanAttributes = (
  attributes: Record<string, string | number | boolean>
) => {
  // No-op
};