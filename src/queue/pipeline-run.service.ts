import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineRunStatus } from '../database/enums/pipeline-run-status.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { ACTIVE_BATCH_LOCK_MS } from './constants';

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
    if (existing?.status === PipelineRunStatus.RUNNING) {
      const ageMs = Date.now() - new Date(existing.startedAt).getTime();
      if (ageMs < ACTIVE_BATCH_LOCK_MS) return 'in-progress';
    }
    if (existing) {
      await this.repo.update(
        { pipelineRunId, step: step as PipelineStep, batchSeq },
        {
          tenantId,
          attempt,
          status: PipelineRunStatus.RUNNING,
          startedAt: new Date(),
          finishedAt: null,
          error: null,
        },
      );
      return 'started';
    }
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
    em?: EntityManager,
  ): Promise<void> {
    const repo = em ? em.getRepository(PipelineRunEntity) : this.repo;
    await repo.update(
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

  public async recordDispatch(
    pipelineRunId: string,
    step: PipelineStep | string,
    planned: number,
    em?: EntityManager,
  ): Promise<void> {
    const repo = em ? em.getRepository(PipelineRunEntity) : this.repo;
    await repo.update(
      {
        pipelineRunId,
        step: step as PipelineStep,
        batchSeq: DISPATCH_BATCH_SEQ,
      },
      { batchesPlanned: planned },
    );
  }

  /**
   * Dispatcher idempotency: skip if a completed dispatch row exists,
   * otherwise upsert it to status=running. Unlike start(), this does
   * NOT treat an existing running row as a conflict — a crashed
   * dispatcher must be able to restart and re-emit. Batch idempotency
   * (start() keyed on batchSeq) prevents duplicate batch execution;
   * batches_done is preserved across restart so the fan-in counter
   * stays consistent.
   */
  public async startOrRestartDispatch(
    pipelineRunId: string,
    tenantId: string,
    step: PipelineStep | string,
    attempt: number,
  ): Promise<'started' | 'already-completed'> {
    const existing = await this.repo.findOne({
      where: {
        pipelineRunId,
        step: step as PipelineStep,
        batchSeq: DISPATCH_BATCH_SEQ,
      },
    });
    if (existing?.status === PipelineRunStatus.COMPLETED)
      return 'already-completed';
    if (existing) {
      await this.repo.update(
        {
          pipelineRunId,
          step: step as PipelineStep,
          batchSeq: DISPATCH_BATCH_SEQ,
        },
        {
          status: PipelineRunStatus.RUNNING,
          attempt,
          startedAt: new Date(),
          finishedAt: null,
          error: null,
          batchesPlanned: null,
        },
      );
    } else {
      await this.repo.save({
        pipelineRunId,
        tenantId,
        step: step as PipelineStep,
        batchSeq: DISPATCH_BATCH_SEQ,
        attempt,
        status: PipelineRunStatus.RUNNING,
        startedAt: new Date(),
      });
    }
    return 'started';
  }

  public async completedBatchSeqs(
    pipelineRunId: string,
    step: PipelineStep | string,
  ): Promise<Set<number>> {
    const rows = await this.repo.find({
      where: {
        pipelineRunId,
        step: step as PipelineStep,
        status: PipelineRunStatus.COMPLETED,
      },
      select: { batchSeq: true },
    });
    return new Set(
      rows.map((r) => r.batchSeq).filter((seq) => seq > DISPATCH_BATCH_SEQ),
    );
  }

  public async lastPublishedBatchSeq(
    pipelineRunId: string,
    step: PipelineStep | string,
  ): Promise<number> {
    const row = await this.repo.findOne({
      where: {
        pipelineRunId,
        step: step as PipelineStep,
        batchSeq: DISPATCH_BATCH_SEQ,
      },
      select: { lastPublishedBatchSeq: true },
    });
    return row?.lastPublishedBatchSeq ?? 0;
  }

  public async updateLastPublishedBatchSeq(
    pipelineRunId: string,
    step: PipelineStep | string,
    batchSeq: number,
  ): Promise<void> {
    await this.repo.update(
      {
        pipelineRunId,
        step: step as PipelineStep,
        batchSeq: DISPATCH_BATCH_SEQ,
      },
      { lastPublishedBatchSeq: batchSeq },
    );
  }

  public async isBatchCompleted(
    pipelineRunId: string,
    step: PipelineStep | string,
    batchSeq: number,
  ): Promise<boolean> {
    const row = await this.repo.findOne({
      where: {
        pipelineRunId,
        step: step as PipelineStep,
        batchSeq,
        status: PipelineRunStatus.COMPLETED,
      },
      select: { id: true },
    });
    return row != null;
  }

  /**
   * Atomic batch completion + fan-in increment in one SQL CTE.
   *
   * Closes bug #1 (the deadlock window between `complete()` and
   * `incrementBatchDone()`). The CTE only bumps the counter when the
   * batch row actually transitions running -> completed, so it's
   * idempotent on broker redelivery: a redelivered already-completed
   * batch re-runs the CTE, the WHERE status='running' filter matches
   * zero rows, count() returns 0, counter stays put. Returns the
   * current counter snapshot either way so callers can detect isLast
   * even on the redelivery path.
   *
   * Accepts an EntityManager (not the injected repo) so the caller's
   * tenant transaction wraps this together with the batch's handle()
   * work + outbox inserts — all-or-nothing atomicity.
   */
  public async completeBatchAndIncrement(
    em: EntityManager,
    pipelineRunId: string,
    step: PipelineStep | string,
    batchSeq: number,
  ): Promise<BatchIncrement> {
    const raw: unknown = await em.query(
      `WITH batch_done AS (
          UPDATE core.pipeline_run
          SET status = $4, finished_at = now(), updated_at = now()
          WHERE pipeline_run_id = $1 AND step = $2 AND batch_seq = $3
            AND status = $5
          RETURNING 1
        )
        UPDATE core.pipeline_run
        SET batches_done = batches_done + (SELECT count(*) FROM batch_done),
            updated_at = now()
        WHERE pipeline_run_id = $1 AND step = $2 AND batch_seq = $6
        RETURNING batches_done, batches_planned`,
      [
        pipelineRunId,
        step,
        batchSeq,
        PipelineRunStatus.COMPLETED,
        PipelineRunStatus.RUNNING,
        DISPATCH_BATCH_SEQ,
      ],
    );
    // em.query returns the rows array for SELECT-like statements but
    // `[rows, affected]` for UPDATE/RETURNING depending on the driver path;
    // normalize so a tuple result doesn't read back as undefined.
    const arr = raw as unknown[];
    const rows = (Array.isArray(arr[0]) ? arr[0] : arr) as Array<{
      batches_done: number;
      batches_planned: number | null;
    }>;
    if (rows.length === 0) {
      throw new Error(
        `completeBatchAndIncrement: no dispatch row for run=${pipelineRunId} step=${step}`,
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
