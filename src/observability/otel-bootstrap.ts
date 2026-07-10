import 'dotenv/config';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = 'deployment.environment.name';

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',').map((kv) => {
      const [k, ...vs] = kv.split('=');
      return [k.trim(), vs.join('=').trim()];
    }),
  );
}

let sdk: NodeSDK | undefined;

/**
 * Start the OpenTelemetry SDK. No-op when:
 *   OTEL_DISABLED=1 (explicit local override), or
 *   OTEL_EXPORTER_OTLP_ENDPOINT is empty (dev default).
 * Must be the first call in main.* so the SDK can patch HTTP/pg/amqplib
 * globals before they're imported.
 */
export function startOtel(): void {
  if (process.env.OTEL_DISABLED === '1') return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'farmacore',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? 'dev',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

/** Flush pending spans; no-op when the SDK never started. */
export async function shutdownOtel(): Promise<void> {
  await sdk
    ?.shutdown()
    .catch((err) => console.error('OTel shutdown error', err));
}
