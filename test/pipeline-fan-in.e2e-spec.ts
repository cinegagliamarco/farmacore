import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PipelineRunService } from '../src/queue/pipeline-run.service';
import { PipelineStep } from '../src/database/enums/pipeline-step.enum';
import { PipelineRunStatus } from '../src/database/enums/pipeline-run-status.enum';

describe('PipelineRunService fan-in (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let svc: PipelineRunService;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    ds = app.get(DataSource);
    svc = app.get(PipelineRunService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('concurrent completeBatchAndIncrement sees isLast=true exactly once', async () => {
    const runId = randomUUID();
    const step = PipelineStep.SYNC_BASE_PRODUCT;
    const tenantId = 'system';
    const planned = 32;

    // Seed a dispatch row + N running batch rows; the CTE only bumps
    // the counter when the matching batch row transitions
    // running -> completed.
    await ds.query(
      `INSERT INTO core.pipeline_run
         (pipeline_run_id, tenant_id, step, status, attempt,
          batch_seq, batches_planned, batches_done, started_at)
       VALUES ($1, $2, $3, $4, 1, 0, $5, 0, now())`,
      [runId, tenantId, step, PipelineRunStatus.RUNNING, planned],
    );
    for (let i = 1; i <= planned; i++) {
      await ds.query(
        `INSERT INTO core.pipeline_run
           (pipeline_run_id, tenant_id, step, status, attempt,
            batch_seq, started_at)
         VALUES ($1, $2, $3, $4, 1, $5, now())`,
        [runId, tenantId, step, PipelineRunStatus.RUNNING, i],
      );
    }

    const outcomes = await Promise.all(
      Array.from({ length: planned }, (_, i) =>
        ds.transaction((em) =>
          svc.completeBatchAndIncrement(em, runId, step, i + 1),
        ),
      ),
    );

    const lastCount = outcomes.filter((o) => o.isLast).length;
    expect(lastCount).toBe(1);

    const dones = outcomes.map((o) => o.done).sort((a, b) => a - b);
    expect(dones).toEqual(Array.from({ length: planned }, (_, i) => i + 1));

    const [row] = await ds.query(
      `SELECT batches_done, batches_planned FROM core.pipeline_run
       WHERE pipeline_run_id = $1 AND step = $2 AND batch_seq = 0`,
      [runId, step],
    );
    expect(row.batches_done).toBe(planned);
    expect(row.batches_planned).toBe(planned);
  });

  it('redelivered batch (already-completed) does not double-bump the counter', async () => {
    const runId = randomUUID();
    const step = PipelineStep.SYNC_BASE_PRODUCT_STOCK;
    const tenantId = 'system';

    await ds.query(
      `INSERT INTO core.pipeline_run
         (pipeline_run_id, tenant_id, step, status, attempt,
          batch_seq, batches_planned, batches_done, started_at)
       VALUES ($1, $2, $3, $4, 1, 0, 1, 0, now())`,
      [runId, tenantId, step, PipelineRunStatus.RUNNING],
    );
    await ds.query(
      `INSERT INTO core.pipeline_run
         (pipeline_run_id, tenant_id, step, status, attempt,
          batch_seq, started_at)
       VALUES ($1, $2, $3, $4, 1, 1, now())`,
      [runId, tenantId, step, PipelineRunStatus.RUNNING],
    );

    const first = await ds.transaction((em) =>
      svc.completeBatchAndIncrement(em, runId, step, 1),
    );
    expect(first).toEqual({ done: 1, planned: 1, isLast: true });

    // Simulate broker redelivery: same batch, already completed.
    const second = await ds.transaction((em) =>
      svc.completeBatchAndIncrement(em, runId, step, 1),
    );
    expect(second).toEqual({ done: 1, planned: 1, isLast: true });
  });
});
