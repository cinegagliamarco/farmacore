import { PipelineStep } from '../database/enums/pipeline-step.enum';

export interface PipelineMessage<TPayload = Record<string, unknown>> {
  pipelineRunId: string;
  tenantId: string;
  step: PipelineStep;
  /**
   * Routing override: when set, the publisher uses this string as the
   * routing-key segment instead of `step`. Lets a logical step
   * (e.g. 'sync-base-product') route to a per-suffix queue
   * (e.g. 'sync-base-product.batch', 'sync-base-product.dispatch',
   * 'import-competitor-products.drogal') without forking the message shape.
   */
  queue?: string;
  attempt: number;
  publishedAt: string;
  payload: TPayload;
  /**
   * Position within a batched step's fan-out. 0 (or undefined) = the
   * dispatch row; 1..N = the per-batch rows. Used as part of the
   * (runId, step, batchSeq) idempotency key on pipeline_run.
   */
  batchSeq?: number;
  /**
   * When true the step runs in isolation: its successors are not staged
   * (no chaining into the rest of the graph). Set by the admin
   * "trigger one routine" endpoint; propagated to fan-out batch messages.
   */
  standalone?: boolean;
}

export interface PipelineStartPayload {
  reason: 'cron' | 'manual';
  startedBy?: string;
}

export function newPipelineMessage<P>(
  args: Omit<PipelineMessage<P>, 'attempt' | 'publishedAt'>,
): PipelineMessage<P> {
  return { ...args, attempt: 1, publishedAt: new Date().toISOString() };
}
