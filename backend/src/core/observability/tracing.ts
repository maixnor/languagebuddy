import { logger } from './logging';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPTraceExporter as OTLPTraceExporterHTTP } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { detectResources, resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';

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
    const useProto = process.env.OTLP_USE_PROTO === 'true';
    
    if (tempoEndpoint) {
      // Tempo (Grafana's tracing backend) via OTLP
      // Use HTTP by default as it's more reliable
      if (useProto) {
        return new OTLPTraceExporter({
          url: `${tempoEndpoint}/v1/traces`,
          headers: {},
        });
      } else {
        return new OTLPTraceExporterHTTP({
          url: `${tempoEndpoint}/v1/traces`,
          headers: {},
        });
      }
    } else if (otlpEndpoint) {
      // Generic OTLP endpoint
      if (useProto) {
        return new OTLPTraceExporter({
          url: otlpEndpoint,
        });
      } else {
        return new OTLPTraceExporterHTTP({
          url: otlpEndpoint,
        });
      }
    } else if (process.env.NODE_ENV === 'development') {
      // In development, still send to Tempo if available, otherwise console
      // This ensures you can see trace structure in Grafana even in dev
      const defaultDevEndpoint = process.env.DEV_TEMPO_ENDPOINT || 'http://localhost:4318/v1/traces';
      logger.debug(`Development mode: sending traces to ${defaultDevEndpoint}`);
      return new OTLPTraceExporterHTTP({
        url: defaultDevEndpoint,
      });
    } else {
      // Default to OTLP HTTP for production (assuming Tempo at localhost)
      return new OTLPTraceExporterHTTP({
        url: 'http://localhost:4318/v1/traces',
      });
    }
  };

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: serviceInfo.name,
      [SEMRESATTRS_SERVICE_VERSION]: serviceInfo.version,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production',
    }),
    traceExporter: getTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable file system instrumentation to reduce noise
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        // Configure HTTP instrumentation for external API calls
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          // Ensure we capture OpenAI and other HTTP client calls
          ignoreIncomingRequestHook: (req) => {
            // Ignore health checks
            return req.url?.includes('/health');
          },
          // Add request/response hooks for better visibility
          requestHook: (span, request) => {
            const headers = (request as any).headers;
            if (headers) {
              span.setAttribute('http.request.header.user_agent', headers['user-agent'] || 'unknown');
            }
          },
          responseHook: (span, response) => {
            span.setAttribute('http.response.status_code', response.statusCode);
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
  
  logger.info('OpenTelemetry tracing initialized successfully');
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

// Helper for OpenAI spans - use CLIENT span kind for external API calls
export const traceOpenAI = <T>(
  operation: string,
  model: string,
  fn: (span: any) => Promise<T>
): Promise<T> => {
  const tracer = trace.getTracer(serviceInfo.name);
  
  return tracer.startActiveSpan(`openai.${operation}`, {
    kind: SpanKind.CLIENT, // CLIENT for external service calls
    attributes: {
      'ai.model': model,
      'ai.operation': operation,
      'ai.system': 'openai',
      'peer.service': 'openai',
    },
  }, async (span) => {
    try {
      const result = await fn(span);
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



// Enhanced helper to add events to current span
export const addSpanEvent = (
  name: string,
  attributes?: Record<string, string | number | boolean>
) => {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(name, attributes);
  }
};

// Helper to add attributes to current span
export const setSpanAttributes = (
  attributes: Record<string, string | number | boolean>
) => {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    Object.entries(attributes).forEach(([key, value]) => {
      activeSpan.setAttribute(key, value);
    });
  }
};
