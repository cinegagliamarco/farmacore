import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import { BasePipelineConsumer, HandleResult } from './base-pipeline.consumer';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { TenantService } from '../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { PipelinePublisher } from './pipeline-publisher.service';
import { noopPipelineMetrics } from '../observability/pipeline-metrics.test-utils';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';

class TestConsumer extends BasePipelineConsumer<{ value: number }> {
  protected step = PipelineStep.SYNC_BASE_PRODUCT;
  public lastInvoked = 0;
  public failNext = false;

  protected handle(): Promise<HandleResult> {
    this.lastInvoked++;
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
  let publisher: { publishStep: jest.Mock };

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
    publisher = { publishStep: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        TestConsumer,
        { provide: PipelineRunService, useValue: runs },
        { provide: RetryService, useValue: retry },
        { provide: TenantTransactionService, useValue: tx },
        { provide: TenantService, useValue: tenants },
        { provide: IntegrationDataSourceFactory, useValue: factory },
        { provide: PipelinePublisher, useValue: publisher },
        { provide: PipelineMetricsRegistry, useValue: noopPipelineMetrics() },
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
    expect(runs.complete).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
    );
  });

  it('skips handle when start returns already-completed', async () => {
    runs.start.mockResolvedValue('already-completed');
    await consumer.process(msg);
    expect(consumer.lastInvoked).toBe(0);
    expect(runs.complete).not.toHaveBeenCalled();
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

  it('publishes successors returned by handle()', async () => {
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
    expect(publisher.publishStep).toHaveBeenCalledWith(successor, undefined, {
      producer: 'consumer:successor',
    });
  });
});
