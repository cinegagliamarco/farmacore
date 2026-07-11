import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import { BasePipelineConsumer, HandleResult } from './base-pipeline.consumer';
import { OutboxRepository } from './outbox.repository';
import { PipelineRunService } from './pipeline-run.service';
import { DuplicateDeliveryRepublishError, RetryService } from './retry.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { TenantService } from '../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { noopPipelineMetrics } from '../observability/pipeline-metrics.test-utils';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';

class TestConsumer extends BasePipelineConsumer<{ value: number }> {
  protected step = PipelineStep.SYNC_BASE_PRODUCT;
  public lastInvoked = 0;
  public failNext = false;
  public duplicateNext = false;

  protected handle(): Promise<HandleResult> {
    this.lastInvoked++;
    if (this.duplicateNext)
      throw new DuplicateDeliveryRepublishError('active execution lock');
    if (this.failNext) throw new Error('boom');
    return Promise.resolve({ successors: [] });
  }
}

describe('BasePipelineConsumer', () => {
  let consumer: TestConsumer;
  let runs: { start: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let retry: { republishOnFailure: jest.Mock };
  let tx: { runWithTenant: jest.Mock };
  let tenants: { findActive: jest.Mock };
  let factory: { forTenantSlug: jest.Mock };
  let outbox: { insertMany: jest.Mock };
  let metrics: ReturnType<typeof noopPipelineMetrics>;

  beforeEach(async () => {
    runs = {
      start: jest.fn().mockResolvedValue('started'),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    retry = { republishOnFailure: jest.fn().mockResolvedValue('retried') };
    tx = {
      runWithTenant: jest.fn(
        (_s: string, fn: (em: EntityManager) => Promise<unknown>) =>
          fn({} as EntityManager),
      ),
    };
    tenants = {
      findActive: jest.fn().mockResolvedValue({
        slug: 'acme',
        schemaName: 'tenant_acme',
        status: 'active',
      }),
    };
    factory = { forTenantSlug: jest.fn().mockResolvedValue(null) };
    outbox = { insertMany: jest.fn() };
    metrics = noopPipelineMetrics();

    const mod = await Test.createTestingModule({
      providers: [
        TestConsumer,
        { provide: PipelineRunService, useValue: runs },
        { provide: RetryService, useValue: retry },
        { provide: TenantTransactionService, useValue: tx },
        { provide: TenantService, useValue: tenants },
        { provide: IntegrationDataSourceFactory, useValue: factory },
        { provide: OutboxRepository, useValue: outbox },
        { provide: PipelineMetricsRegistry, useValue: metrics },
      ],
    }).compile();
    consumer = mod.get(TestConsumer);
  });

  const msg = {
    pipelineRunId: 'run1',
    tenantId: 'acme',
    step: PipelineStep.SYNC_BASE_PRODUCT,
    attempt: 1,
    publishedAt: 'now',
    payload: { value: 1 },
  } as const;

  it('runs handle when start returns started', async () => {
    await consumer.process(msg);
    expect(consumer.lastInvoked).toBe(1);
    // complete shares the tenant tx with handle + outbox staging.
    expect(runs.complete).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      undefined,
      expect.anything(),
    );
  });

  it('skips handle when start returns already-completed', async () => {
    runs.start.mockResolvedValue('already-completed');
    await consumer.process(msg);
    expect(consumer.lastInvoked).toBe(0);
    expect(runs.complete).not.toHaveBeenCalled();
  });

  it('routes a duplicate delivery of an in-progress step to the DLQ without touching the run row', async () => {
    runs.start.mockResolvedValue('in-progress');
    await consumer.process(msg);
    expect(consumer.lastInvoked).toBe(0);
    expect(retry.republishOnFailure).toHaveBeenCalledWith(msg);
    expect(runs.complete).not.toHaveBeenCalled();
    // fail() here would clobber the original delivery's RUNNING row.
    expect(runs.fail).not.toHaveBeenCalled();
  });

  it('rethrows a failed in-progress republish so the broker DLX takes over (no fail row)', async () => {
    runs.start.mockResolvedValue('in-progress');
    retry.republishOnFailure.mockRejectedValue(new Error('channel closed'));
    await expect(consumer.process(msg)).rejects.toBeInstanceOf(
      DuplicateDeliveryRepublishError,
    );
    // Must bypass the generic catch: its fail() would clobber the original
    // delivery's RUNNING row (COMPLETED→FAILED flip).
    expect(runs.fail).not.toHaveBeenCalled();
    expect(runs.complete).not.toHaveBeenCalled();
  });

  it('rethrows a step-level duplicate lock and closes its metrics exactly once', async () => {
    consumer.duplicateNext = true;

    await expect(consumer.process(msg)).rejects.toBeInstanceOf(
      DuplicateDeliveryRepublishError,
    );

    expect(metrics.onConsumeStart).toHaveBeenCalledTimes(1);
    expect(metrics.onConsumeEnd).toHaveBeenCalledTimes(1);
    expect(metrics.onConsumeEnd).toHaveBeenCalledWith(
      'acme',
      PipelineStep.SYNC_BASE_PRODUCT,
      'skip',
      0,
    );
    expect(runs.fail).not.toHaveBeenCalled();
  });

  it('on failure -> retry, on retry returning dlq -> fail row', async () => {
    consumer.failNext = true;
    await consumer.process(msg);
    expect(retry.republishOnFailure).toHaveBeenCalled();
    expect(runs.fail).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      expect.stringContaining('boom'),
    );
  });

  it('stages successors returned by handle() to the outbox', async () => {
    const successor = {
      pipelineRunId: 'run1',
      tenantId: 'acme',
      step: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
      attempt: 1,
      publishedAt: 'now',
      payload: {},
    };
    (consumer as unknown as { handle: () => Promise<HandleResult> }).handle =
      () => Promise.resolve({ successors: [successor] });
    await consumer.process(msg);
    // Successors go to the outbox in the same tx as complete, not to AMQP.
    expect(outbox.insertMany).toHaveBeenCalledWith(
      expect.anything(), // em
      'run1',
      'acme',
      [successor],
    );
  });
});
