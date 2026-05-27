import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import { BatchPipelineConsumer } from './batch-pipeline.consumer';
import { PipelineRunService, BatchIncrement } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { TenantService } from '../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineMessage } from './types';

class TestBatchConsumer extends BatchPipelineConsumer<{ ids: number[] }> {
  protected logicalStep = PipelineStep.SYNC_BASE_PRODUCT;
  public lastInvoked = 0;
  public failNext = false;
  public successorsCalled = 0;
  public successorsToReturn: PipelineMessage<unknown>[] = [];

  protected handle(): Promise<void> {
    this.lastInvoked++;
    if (this.failNext) throw new Error('boom');
    return Promise.resolve();
  }

  protected successors(): Promise<PipelineMessage<unknown>[]> {
    this.successorsCalled++;
    return Promise.resolve(this.successorsToReturn);
  }
}

describe('BatchPipelineConsumer', () => {
  let consumer: TestBatchConsumer;
  let runs: {
    start: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    incrementBatchDone: jest.Mock;
  };
  let retry: { republishOnFailure: jest.Mock };
  let tx: { runWithTenant: jest.Mock };
  let tenants: { findActive: jest.Mock };
  let factory: { forTenantSlug: jest.Mock };
  let publisher: { publishStep: jest.Mock };

  const buildMsg = (
    batchSeq: number,
  ): PipelineMessage<{ ids: number[] }> => ({
    pipelineRunId: 'run1',
    tenantId: 'acme',
    step: PipelineStep.SYNC_BASE_PRODUCT,
    queue: 'sync-base-product.batch',
    attempt: 1,
    publishedAt: 'now',
    payload: { ids: [1, 2, 3] },
    batchSeq,
  });

  beforeEach(async () => {
    runs = {
      start: jest.fn().mockResolvedValue('started'),
      complete: jest.fn(),
      fail: jest.fn(),
      incrementBatchDone: jest.fn(),
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
        TestBatchConsumer,
        { provide: PipelineRunService, useValue: runs },
        { provide: RetryService, useValue: retry },
        { provide: TenantTransactionService, useValue: tx },
        { provide: TenantService, useValue: tenants },
        { provide: IntegrationDataSourceFactory, useValue: factory },
        { provide: PipelinePublisher, useValue: publisher },
      ],
    }).compile();
    consumer = mod.get(TestBatchConsumer);
  });

  it('rejects messages without a batchSeq >= 1', async () => {
    const msg = { ...buildMsg(1), batchSeq: 0 };
    await consumer.process(msg);
    expect(runs.fail).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      expect.stringContaining('requires batchSeq'),
      0,
    );
  });

  it('runs handle and increments fan-in counter', async () => {
    runs.incrementBatchDone.mockResolvedValue({
      done: 1,
      planned: 4,
      isLast: false,
    } satisfies BatchIncrement);
    await consumer.process(buildMsg(1));
    expect(consumer.lastInvoked).toBe(1);
    expect(runs.complete).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      1,
    );
    expect(runs.incrementBatchDone).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
    );
  });

  it('does NOT call successors() or publish when not the last batch', async () => {
    runs.incrementBatchDone.mockResolvedValue({
      done: 2,
      planned: 4,
      isLast: false,
    });
    await consumer.process(buildMsg(2));
    expect(consumer.successorsCalled).toBe(0);
    expect(publisher.publishStep).not.toHaveBeenCalled();
  });

  it('calls successors() once and publishes them when isLast', async () => {
    const successor: PipelineMessage = {
      pipelineRunId: 'run1',
      tenantId: 'acme',
      step: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
      attempt: 1,
      publishedAt: 'now',
      payload: {},
    };
    consumer.successorsToReturn = [successor];
    runs.incrementBatchDone.mockResolvedValue({
      done: 4,
      planned: 4,
      isLast: true,
    });
    await consumer.process(buildMsg(4));
    expect(consumer.successorsCalled).toBe(1);
    expect(publisher.publishStep).toHaveBeenCalledWith(successor);
  });

  it('skips handle when start returns already-completed', async () => {
    runs.start.mockResolvedValue('already-completed');
    await consumer.process(buildMsg(1));
    expect(consumer.lastInvoked).toBe(0);
    expect(runs.incrementBatchDone).not.toHaveBeenCalled();
  });

  it('on failure -> retry + fail row keyed on batchSeq', async () => {
    consumer.failNext = true;
    await consumer.process(buildMsg(3));
    expect(retry.republishOnFailure).toHaveBeenCalled();
    expect(runs.fail).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      expect.stringContaining('boom'),
      3,
    );
  });
});
