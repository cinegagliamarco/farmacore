import { EntityManager } from 'typeorm';
import { ApplyPriceDispatchConsumer } from './apply-price.dispatch.consumer';
import type {
  DispatchHandleContext,
  DispatchHandleResult,
} from '../../queue/dispatch-pipeline.consumer';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { TenantEntity } from '../../database/entities/core/tenant.entity';

type Captured = { sql: string; params: unknown[] };

const buildEm = (
  items: Array<{ id: string }>,
  queries: Captured[],
): EntityManager =>
  ({
    query: (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT id FROM pricing_apply_item')) {
        return Promise.resolve(items);
      }
      return Promise.resolve([]);
    },
  }) as unknown as EntityManager;

const buildCtx = (em: EntityManager): DispatchHandleContext => ({
  message: {
    pipelineRunId: 'run1',
    tenantId: 'acme',
    step: PipelineStep.APPLY_PRICE,
    attempt: 1,
    publishedAt: 'now',
    payload: {},
  },
  em,
  integrationDs: null,
  tenant: { slug: 'acme' } as TenantEntity,
});

describe('ApplyPriceDispatchConsumer.handle', () => {
  let consumer: {
    handle: (ctx: DispatchHandleContext) => Promise<DispatchHandleResult>;
  };

  beforeEach(() => {
    consumer = new ApplyPriceDispatchConsumer(
      {
        getApiCredentials: jest.fn().mockResolvedValue({ token: 't' }),
      } as unknown as IntegrationConnectionService,
      null as unknown as PipelineRunService,
      null as unknown as RetryService,
      null as unknown as TenantTransactionService,
      null as unknown as TenantService,
      null as unknown as IntegrationDataSourceFactory,
      null as unknown as PipelinePublisher,
    ) as unknown as {
      handle: (ctx: DispatchHandleContext) => Promise<DispatchHandleResult>;
    };
  });

  // Replay invariant: the item SELECT must NOT filter by status. Slicing
  // every item of the run keeps batch_seq deterministic when the dispatch
  // row is re-run after a crash — filtering to `AND status='pending'`
  // (the "obvious optimization") would reshuffle seqs once some batches
  // are COMPLETED, and items landing in an already-completed seq would
  // never be applied. Status filtering belongs to the batch consumer.
  it('selects ALL items of the run, without a status filter', async () => {
    const queries: Captured[] = [];
    const items = [{ id: 'i1' }, { id: 'i2' }];
    await consumer.handle(buildCtx(buildEm(items, queries)));

    const selects = queries.filter((q) =>
      q.sql.includes('SELECT id FROM pricing_apply_item'),
    );
    expect(selects).toHaveLength(1);
    expect(selects[0].sql).not.toMatch(/status/);
    expect(selects[0].sql).toContain('ORDER BY id');
    expect(selects[0].params).toEqual(['run1']);
  });

  it('assigns the same batch_seq to the same items across two dispatches of the run', async () => {
    // 120 items -> 3 batches of 50/50/20 with BATCH_SIZE=50.
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: `item-${String(i).padStart(3, '0')}`,
    }));

    const runDispatch = async () => {
      const queries: Captured[] = [];
      const result = await consumer.handle(buildCtx(buildEm(items, queries)));
      const seqUpdates = queries
        .filter((q) => q.sql.includes('SET batch_seq'))
        .map((q) => q.params);
      return { result, seqUpdates };
    };

    const first = await runDispatch();
    const second = await runDispatch();

    expect(first.result.batches.map((b) => b.batchSeq)).toEqual([1, 2, 3]);
    // Same (ids, seq) writes both times — the seq an item got on the first
    // dispatch is the seq it keeps on replay.
    expect(second.seqUpdates).toEqual(first.seqUpdates);
    expect(second.result.batches.map((b) => b.batchSeq)).toEqual(
      first.result.batches.map((b) => b.batchSeq),
    );
  });
});
