import { NodeSDK, resources } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';

// Get version info for service identification
const getServiceInfo = () => {
  try {
    const packageJson = require('../../package.json');
    return {
      name: 'languagebuddy-backend',
      version: packageJson.version || 'unknown'
    };
  } catch {
    return {
      name: 'languagebuddy-backend', 
      version: 'unknown'
    };
  }
};

const serviceInfo = getServiceInfo();

// Configure the OpenTelemetry SDK
export const initializeTracing = () => {
  // Determine exporter based on environment
  const getTraceExporter = () => {
    const tempoEndpoint = process.env.TEMPO_ENDPOINT;
    const otlpEndpoint = process.env.OTLP_ENDPOINT;
    
    if (tempoEndpoint) {
      // Tempo (Grafana's tracing backend) via OTLP
      return new OTLPTraceExporter({
        url: `${tempoEndpoint}/v1/traces`,
        headers: {},
      });
    } else if (otlpEndpoint) {
      // Generic OTLP endpoint
      return new OTLPTraceExporter({
        url: otlpEndpoint,
      });
    } else if (process.env.NODE_ENV === 'development') {
      // Console output for development
      return new ConsoleSpanExporter();
    } else {
      // Default to OTLP for production (assuming Tempo at localhost)
      return new OTLPTraceExporter({
        url: 'http://localhost:3200/v1/traces',
      });
    }
  };

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': serviceInfo.name,
      'service.version': serviceInfo.version,
    }),
    traceExporter: getTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable file system instrumentation to reduce noise
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        // Configure Redis instrumentation
        '@opentelemetry/instrumentation-ioredis': {
          enabled: true,
        },
        // Configure HTTP instrumentation for external API calls
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          ignoreIncomingRequestHook: (req) => {
            // Ignore health checks and static files
            return req.url?.includes('/health') || req.url?.includes('/static');
          },
        },
        // Express instrumentation
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
      }),
    ],
  });

  sdk.start();
  
  console.log('OpenTelemetry tracing initialized successfully');
  return sdk;
};

// Helper function to create custom spans for business logic
export const createBusinessSpan = <T>(
  name: string,
  operation: (span: any) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> => {
  const tracer = trace.getTracer(serviceInfo.name);
  
  return tracer.startActiveSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: attributes || {},
  }, async (span) => {
    try {
      const result = await operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
};

// Helper to get current trace context for logging
export const getTraceContext = () => {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) {
    return {};
  }
  
  const spanContext = activeSpan.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
};

// Helper for conversation-specific spans
export const traceConversation = <T>(
  operation: string,
  phoneNumber: string,
  fn: (span: any) => Promise<T>
): Promise<T> => {
  return createBusinessSpan(
    `conversation.${operation}`,
    fn,
    {
      'user.phone': phoneNumber.slice(-4), // Only last 4 digits for privacy
      'conversation.operation': operation,
    }
  );
};

// Helper for WhatsApp service spans  
export const traceWhatsApp = <T>(
  operation: string,
  phoneNumber: string,
  fn: (span: any) => Promise<T>
): Promise<T> => {
  return createBusinessSpan(
    `whatsapp.${operation}`,
    fn,
    {
      'user.phone': phoneNumber.slice(-4),
      'whatsapp.operation': operation,
    }
  );
};

// Helper for OpenAI spans
export const traceOpenAI = <T>(
  operation: string,
  model: string,
  fn: (span: any) => Promise<T>
): Promise<T> => {
  return createBusinessSpan(
    `openai.${operation}`,
    fn,
    {
      'ai.model': model,
      'ai.operation': operation,
    }
  );
};
