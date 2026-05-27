import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import {
  DispatchPipelineConsumer,
  DispatchHandleResult,
} from './dispatch-pipeline.consumer';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { TenantService } from '../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineMessage } from './types';

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
  };
  let retry: { republishOnFailure: jest.Mock };
  let tx: { runWithTenant: jest.Mock };
  let tenants: { findActive: jest.Mock };
  let factory: { forTenantSlug: jest.Mock };
  let publisher: { publishStep: jest.Mock };

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

  beforeEach(async () => {
    runs = {
      startOrRestartDispatch: jest.fn().mockResolvedValue('started'),
      complete: jest.fn(),
      fail: jest.fn(),
      recordDispatch: jest.fn(),
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
        TestDispatchConsumer,
        { provide: PipelineRunService, useValue: runs },
        { provide: RetryService, useValue: retry },
        { provide: TenantTransactionService, useValue: tx },
        { provide: TenantService, useValue: tenants },
        { provide: IntegrationDataSourceFactory, useValue: factory },
        { provide: PipelinePublisher, useValue: publisher },
      ],
    }).compile();
    consumer = mod.get(TestDispatchConsumer);
  });

  it('publishes N batches and records planned=N', async () => {
    const batches: PipelineMessage[] = [1, 2, 3].map((seq) => ({
      pipelineRunId: 'run1',
      tenantId: 'acme',
      step: PipelineStep.SYNC_BASE_PRODUCT,
      queue: 'sync-base-product.batch',
      batchSeq: seq,
      attempt: 1,
      publishedAt: 'now',
      payload: {},
    }));
    consumer.toReturn = { batches };

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

  it('publishes emptySuccessors when batches is empty', async () => {
    consumer.toReturn = {
      batches: [],
      emptySuccessors: [successor(PipelineStep.SYNC_BASE_PRODUCT_STOCK)],
    };
    await consumer.process(msg);
    expect(runs.recordDispatch).toHaveBeenCalledWith(
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      0,
    );
    expect(publisher.publishStep).toHaveBeenCalledTimes(1);
    expect(runs.complete).toHaveBeenCalled();
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
