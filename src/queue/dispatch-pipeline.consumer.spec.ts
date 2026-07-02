import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import {
  DispatchPipelineConsumer,
  DispatchHandleResult,
} from './dispatch-pipeline.consumer';
import { OutboxRepository } from './outbox.repository';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { TenantService } from '../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineMessage } from './types';
import { AppConfigService } from '../config/app-config.service';
import { noopPipelineMetrics } from '../observability/pipeline-metrics.test-utils';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';

class TestDispatchConsumer extends DispatchPipelineConsumer<{ total: number }> {
  protected logicalStep = PipelineStep.SYNC_BASE_PRODUCT;
  public toReturn: DispatchHandleResult = { batches: [] };
  public failNext = false;

  protected handle(): Promise<DispatchHandleResult> {
    if (this.failNext) throw new Error('boom');
    return Promise.resolve(this.toReturn);
  }
}

describe('DispatchPipelineConsumer', () => {
  let consumer: TestDispatchConsumer;
  let runs: {
    startOrRestartDispatch: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    recordDispatch: jest.Mock;
    completedBatchSeqs: jest.Mock;
    lastPublishedBatchSeq: jest.Mock;
    updateLastPublishedBatchSeq: jest.Mock;
  };
  let retry: { republishOnFailure: jest.Mock };
  let tx: { runWithTenant: jest.Mock };
  let tenants: { findActive: jest.Mock };
  let factory: { forTenantSlug: jest.Mock };
  let publisher: { publishStep: jest.Mock };
  let outbox: { insertMany: jest.Mock; insertBatchMessages: jest.Mock };
  let config: {
    pipelineDispatchOutboxPublish: boolean;
    pipelineDispatchPublishCheckpoint: number;
    pipelinePublishTimeoutMs: number;
  };

  const msg: PipelineMessage<{ total: number }> = {
    pipelineRunId: 'run1',
    tenantId: 'acme',
    step: PipelineStep.SYNC_BASE_PRODUCT,
    queue: 'sync-base-product.dispatch',
    attempt: 1,
    publishedAt: 'now',
    payload: { total: 0 },
  };

  const successor = (s: PipelineStep): PipelineMessage => ({
    pipelineRunId: 'run1',
    tenantId: 'acme',
    step: s,
    attempt: 1,
    publishedAt: 'now',
    payload: {},
  });

  const batch = (seq: number): PipelineMessage => ({
    pipelineRunId: 'run1',
    tenantId: 'acme',
    step: PipelineStep.SYNC_BASE_PRODUCT,
    queue: 'sync-base-product.batch',
    batchSeq: seq,
    attempt: 1,
    publishedAt: 'now',
    payload: {},
  });

  beforeEach(async () => {
    runs = {
      startOrRestartDispatch: jest.fn().mockResolvedValue('started'),
      complete: jest.fn(),
      fail: jest.fn(),
      recordDispatch: jest.fn(),
      completedBatchSeqs: jest.fn().mockResolvedValue(new Set<number>()),
      lastPublishedBatchSeq: jest.fn().mockResolvedValue(0),
      updateLastPublishedBatchSeq: jest.fn(),
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
    outbox = { insertMany: jest.fn(), insertBatchMessages: jest.fn() };
    config = {
      pipelineDispatchOutboxPublish: false,
      pipelineDispatchPublishCheckpoint: 1000,
      pipelinePublishTimeoutMs: 0,
    };

    const mod = await Test.createTestingModule({
      providers: [
        TestDispatchConsumer,
        { provide: PipelineRunService, useValue: runs },
        { provide: RetryService, useValue: retry },
        { provide: TenantTransactionService, useValue: tx },
        { provide: TenantService, useValue: tenants },
        { provide: IntegrationDataSourceFactory, useValue: factory },
        { provide: PipelinePublisher, useValue: publisher },
        { provide: OutboxRepository, useValue: outbox },
        { provide: AppConfigService, useValue: config },
        { provide: PipelineMetricsRegistry, useValue: noopPipelineMetrics() },
      ],
    }).compile();
    consumer = mod.get(TestDispatchConsumer);
  });

  it('publishes N batches and records planned=N', async () => {
    consumer.toReturn = { batches: [1, 2, 3].map(batch) };

    await consumer.process(msg);

    expect(runs.recordDispatch).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      3,
    );
    expect(publisher.publishStep).toHaveBeenCalledTimes(3);
    expect(runs.complete).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
    );
  });

  it('skips already-completed and checkpoint-resumed batches on restart', async () => {
    runs.completedBatchSeqs.mockResolvedValue(new Set([1, 2]));
    runs.lastPublishedBatchSeq.mockResolvedValue(2);
    consumer.toReturn = { batches: [1, 2, 3, 4].map(batch) };

    await consumer.process(msg);

    expect(publisher.publishStep).toHaveBeenCalledTimes(2);
    expect(publisher.publishStep).toHaveBeenCalledWith(
      expect.objectContaining({ batchSeq: 3 }),
      0,
      { producer: 'dispatch:sync-base-product', count: 1 },
    );
    expect(publisher.publishStep).toHaveBeenCalledWith(
      expect.objectContaining({ batchSeq: 4 }),
      0,
      { producer: 'dispatch:sync-base-product', count: 1 },
    );
  });

  it('stages batches to outbox when PIPELINE_DISPATCH_OUTBOX_PUBLISH=1', async () => {
    config.pipelineDispatchOutboxPublish = true;
    consumer.toReturn = { batches: [1, 2].map(batch) };

    await consumer.process(msg);

    expect(outbox.insertBatchMessages).toHaveBeenCalledWith(
      'run1',
      'acme',
      expect.arrayContaining([
        expect.objectContaining({ batchSeq: 1 }),
        expect.objectContaining({ batchSeq: 2 }),
      ]),
    );
    expect(publisher.publishStep).not.toHaveBeenCalled();
    expect(runs.updateLastPublishedBatchSeq).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      2,
    );
  });

  it('stages emptySuccessors to outbox when batches is empty', async () => {
    const empty = successor(PipelineStep.SYNC_BASE_PRODUCT_STOCK);
    consumer.toReturn = {
      batches: [],
      emptySuccessors: [empty],
    };
    await consumer.process(msg);
    expect(runs.recordDispatch).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      0,
      expect.anything(),
    );
    expect(runs.complete).toHaveBeenCalled();
    expect(outbox.insertMany).toHaveBeenCalledWith(
      expect.anything(),
      'run1',
      'acme',
      [empty],
    );
    expect(publisher.publishStep).not.toHaveBeenCalled();
  });

  it('skips when dispatch row is already-completed (idempotent)', async () => {
    runs.startOrRestartDispatch.mockResolvedValue('already-completed');
    await consumer.process(msg);
    expect(runs.recordDispatch).not.toHaveBeenCalled();
    expect(publisher.publishStep).not.toHaveBeenCalled();
    expect(runs.complete).not.toHaveBeenCalled();
  });

  it('on failure -> retry + fail row', async () => {
    consumer.failNext = true;
    await consumer.process(msg);
    expect(retry.republishOnFailure).toHaveBeenCalled();
    expect(runs.fail).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      expect.stringContaining('boom'),
    );
  });
});
