import type { PipelineOutboxMessage } from '../database/entities/core/pipeline-outbox.entity';

export type PipelineMessage<TPayload = object> = Omit<
  PipelineOutboxMessage,
  'payload'
> & { payload: TPayload };

export interface PipelineStartPayload {
  reason: 'cron' | 'manual';
  startedBy?: string;
}

export function newPipelineMessage<P extends object>(
  args: Omit<PipelineMessage<P>, 'attempt' | 'publishedAt'>,
): PipelineMessage<P> {
  return { ...args, attempt: 1, publishedAt: new Date().toISOString() };
}
