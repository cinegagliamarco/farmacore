import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineRunStatus } from '../database/enums/pipeline-run-status.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export type StartOutcome = 'started' | 'already-completed' | 'in-progress';

export interface BatchIncrement {
  done: number;
  planned: number;
  isLast: boolean;
}

const DISPATCH_BATCH_SEQ = 0;

@Injectable()
export class PipelineRunService {
  constructor(
    @InjectRepository(PipelineRunEntity)
    private readonly repo: Repository<PipelineRunEntity>,
  ) {}

  public async start(
    pipelineRunId: string,
    tenantId: string,
    step: PipelineStep | string,
    attempt: number,
    batchSeq: number = DISPATCH_BATCH_SEQ,
  ): Promise<StartOutcome> {
    const existing = await this.repo.findOne({
      where: { pipelineRunId, step: step as PipelineStep, batchSeq },
    });
    if (existing?.status === PipelineRunStatus.COMPLETED)
      return 'already-completed';
    if (existing?.status === PipelineRunStatus.RUNNING) return 'in-progress';
    await this.repo.save({
      pipelineRunId,
      tenantId,
      step: step as PipelineStep,
      batchSeq,
      attempt,
      status: PipelineRunStatus.RUNNING,
      startedAt: new Date(),
    });
    return 'started';
  }

  public async complete(
    pipelineRunId: string,
    step: PipelineStep | string,
    batchSeq: number = DISPATCH_BATCH_SEQ,
  ): Promise<void> {
    await this.repo.update(
      { pipelineRunId, step: step as PipelineStep, batchSeq },
      { status: PipelineRunStatus.COMPLETED, finishedAt: new Date() },
    );
  }

  public async fail(
    pipelineRunId: string,
    step: PipelineStep | string,
    error: string,
    batchSeq: number = DISPATCH_BATCH_SEQ,
  ): Promise<void> {
    await this.repo.update(
      { pipelineRunId, step: step as PipelineStep, batchSeq },
      {
        status: PipelineRunStatus.FAILED,
        finishedAt: new Date(),
        error: error.slice(0, 4000),
      },
    );
  }

  public async isCompleted(
    pipelineRunId: string,
    step: PipelineStep | string,
    batchSeq: number = DISPATCH_BATCH_SEQ,
  ): Promise<boolean> {
    const row = await this.repo.findOne({
      where: {
        pipelineRunId,
        step: step as PipelineStep,
        batchSeq,
        status: PipelineRunStatus.COMPLETED,
      },
    });
    return row !== null;
  }

  public async recordDispatch(
    pipelineRunId: string,
    step: PipelineStep | string,
    planned: number,
  ): Promise<void> {
    await this.repo.update(
      {
        pipelineRunId,
        step: step as PipelineStep,
        batchSeq: DISPATCH_BATCH_SEQ,
      },
      { batchesPlanned: planned },
    );
  }

  public async incrementBatchDone(
    pipelineRunId: string,
    step: PipelineStep | string,
  ): Promise<BatchIncrement> {
    const rows: Array<{ batches_done: number; batches_planned: number | null }> =
      await this.repo.query(
        `UPDATE core.pipeline_run
         SET batches_done = batches_done + 1, updated_at = now()
         WHERE pipeline_run_id = $1 AND step = $2 AND batch_seq = $3
         RETURNING batches_done, batches_planned`,
        [pipelineRunId, step, DISPATCH_BATCH_SEQ],
      );
    if (rows.length === 0) {
      throw new Error(
        `incrementBatchDone: no dispatch row for run=${pipelineRunId} step=${step}`,
      );
    }
    const { batches_done, batches_planned } = rows[0];
    const planned = batches_planned ?? 0;
    return {
      done: batches_done,
      planned,
      isLast: planned > 0 && batches_done >= planned,
    };
  }
}
