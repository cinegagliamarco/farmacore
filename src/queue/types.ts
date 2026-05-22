import { PipelineStep } from '../database/enums/pipeline-step.enum';

export interface PipelineMessage<TPayload = Record<string, unknown>> {
  pipelineRunId: string;
  tenantId: string;
  step: PipelineStep;
  attempt: number;
  publishedAt: string;
  payload: TPayload;
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
