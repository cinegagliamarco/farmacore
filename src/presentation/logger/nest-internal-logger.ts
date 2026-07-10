import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { InternalLogger } from '../../interfaces';

function resolveContext(ctx: unknown): string | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  if (typeof ctx === 'string') return ctx;
  if (typeof ctx === 'object') {
    const ctor = (ctx as { constructor?: { name?: string } }).constructor;
    return ctor?.name ?? 'Object';
  }
  if (
    typeof ctx === 'number' ||
    typeof ctx === 'boolean' ||
    typeof ctx === 'bigint'
  ) {
    return String(ctx);
  }
  return undefined;
}

/**
 * If an OTel span is active, stamp its traceId/spanId on object
 * payloads so log aggregators can click-through to the trace.
 * Strings are forwarded unchanged — the trace IDs only attach where
 * they have a structured payload to ride on.
 */
function enrichWithTrace(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  const span = trace.getActiveSpan();
  if (!span) return payload;
  const { traceId, spanId } = span.spanContext();
  return { ...(payload as Record<string, unknown>), traceId, spanId };
}

export class NestInternalLogger implements InternalLogger {
  constructor(private readonly nest: Logger) {}

  public log(payload: unknown, ctx?: unknown): void {
    this.nest.log(enrichWithTrace(payload), resolveContext(ctx));
  }

  public warn(payload: unknown, ctx?: unknown): void {
    this.nest.warn(enrichWithTrace(payload), resolveContext(ctx));
  }

  public error(message: string, ctx?: unknown): void {
    this.nest.error(message, resolveContext(ctx));
  }

  public debug(payload: unknown, ctx?: unknown): void {
    this.nest.debug(enrichWithTrace(payload), resolveContext(ctx));
  }
}
