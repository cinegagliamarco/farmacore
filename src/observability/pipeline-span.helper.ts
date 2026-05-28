import { SpanKind, SpanStatusCode, trace, Tracer } from '@opentelemetry/api';

const tracer: Tracer = trace.getTracer('farmacore.pipeline');

export interface PipelineSpanAttrs {
  tenantId: string;
  pipelineRunId: string;
  step: string;
  attempt: number;
  batchSeq?: number;
}

/**
 * Wrap an async function in an OTel CONSUMER span tagged with the
 * pipeline message's tenant/run/step/attempt. Exceptions are recorded
 * on the span (ERROR status) but always re-thrown — the caller decides
 * whether to swallow.
 */
export async function withPipelineSpan<T>(
  attrs: PipelineSpanAttrs,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `pipeline.${attrs.step}${attrs.batchSeq != null ? `#${attrs.batchSeq}` : ''}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'tenant.id': attrs.tenantId,
        'pipeline.run_id': attrs.pipelineRunId,
        'pipeline.step': attrs.step,
        'pipeline.attempt': attrs.attempt,
        ...(attrs.batchSeq != null
          ? { 'pipeline.batch_seq': attrs.batchSeq }
          : {}),
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        const message = (err as Error).message;
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
