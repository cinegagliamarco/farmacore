import { Inject, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { EntityManager, DataSource } from 'typeorm';
import { OutboxRepository } from './outbox.repository';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { PipelinePublisher } from './pipeline-publisher.service';
import { TenantService } from '../tenant/tenant.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { withPipelineSpan } from '../observability/pipeline-span.helper';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';
import { PipelineMessage } from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { AppConfigService } from '../config/app-config.service';

const OUTBOX_INSERT_CHUNK = 1000;

export interface DispatchHandleResult {
  /**
   * The full set of batch messages this dispatcher emits for the run.
   * Each must carry a deterministic batchSeq in 1..N and the correct
   * routing-key segment via `queue` (e.g. 'sync-base-product.batch',
   * 'import-competitor-products.drogal'). Payload shape is per-step;
   * the base class only forwards the message to the publisher.
   */
  batches: PipelineMessage<unknown>[];
  /**
   * Optional successors to publish IF batches.length === 0 (no work to
   * do). In the normal case batches drive the fan-in; this list lets a
   * single-shot or empty-data dispatcher short-circuit to the next step.
   */
  emptySuccessors?: PipelineMessage<unknown>[];
}

export interface DispatchHandleContext<TPayload = unknown> {
  message: PipelineMessage<TPayload>;
  em: EntityManager;
  integrationDs: DataSource | null;
  tenant: TenantEntity;
}

/**
 * Base class for a dispatch consumer in the v2 dispatcher/batch topology.
 *
 * The dispatcher receives one message per (tenant, run). It:
 *   1. Idempotently claims the dispatch row (batchSeq=0). If the row is
 *      already completed, exits — broker redelivery / restart is safe.
 *   2. Runs handle() to compute the deterministic batch list.
 *   3. Records the planned count, publishes each batch, then completes
 *      the dispatch row.
 *
 * If `batches` is empty, emptySuccessors are published instead — useful
 * when the source has no rows and the step is effectively a no-op.
 */
@Injectable()
export abstract class DispatchPipelineConsumer<TPayload = unknown> {
  protected abstract readonly logicalStep: PipelineStep;
  protected readonly logger = new Logger(this.constructor.name);

  // Property injection so concrete dispatchers don't thread
  // OutboxRepository through their super() calls.
  @Inject(OutboxRepository)
  protected readonly outbox!: OutboxRepository;

  @Inject(AppConfigService)
  protected readonly config!: AppConfigService;

  @Inject(PipelineMetricsRegistry)
  protected readonly metrics!: PipelineMetricsRegistry;

  constructor(
    protected readonly runs: PipelineRunService,
    protected readonly retry: RetryService,
    protected readonly tx: TenantTransactionService,
    protected readonly tenants: TenantService,
    protected readonly integrationFactory: IntegrationDataSourceFactory,
    protected readonly publisher: PipelinePublisher,
  ) {}

  protected abstract handle(
    ctx: DispatchHandleContext<TPayload>,
  ): Promise<DispatchHandleResult>;

  public async process(message: PipelineMessage<TPayload>): Promise<void> {
    const queue = `${this.logicalStep}.dispatch`;
    await withPipelineSpan(
      {
        tenantId: message.tenantId,
        pipelineRunId: message.pipelineRunId,
        step: `${this.logicalStep}.dispatch`,
        attempt: message.attempt,
      },
      async () => {
        try {
          const outcome = await this.runs.startOrRestartDispatch(
            message.pipelineRunId,
            message.tenantId,
            this.logicalStep,
            message.attempt,
          );
          if (outcome === 'already-completed') {
            this.logger.debug(
              `Skipping ${this.logicalStep}.dispatch for run ${message.pipelineRunId}: already completed`,
            );
            this.metrics.onConsumeEnd(message.tenantId, queue, 'skip', 0);
            return;
          }

          this.metrics.onConsumeStart(message.tenantId, queue);
          const t0 = Date.now();

          const tenant = await this.tenants.findActive(message.tenantId);
          const integrationDs = await this.integrationFactory.forTenantSlug(
            tenant.slug,
          );

          // Empty path is atomic via the tenant tx (recordDispatch +
          // complete + outbox-staged emptySuccessors all-or-nothing).
          // The batches path keeps direct AMQP publish — batches are
          // re-emittable via startOrRestartDispatch on crash, and the
          // 1-to-1 outbox staging of N batches would balloon the table.
          const result = await this.tx.runWithTenant(
            tenant.schemaName,
            async (em) => {
              const r = await this.handle({
                message,
                em,
                integrationDs,
                tenant,
              });
              if (r.batches.length === 0) {
                await this.runs.recordDispatch(
                  message.pipelineRunId,
                  this.logicalStep,
                  0,
                  em,
                );
                await this.runs.complete(
                  message.pipelineRunId,
                  this.logicalStep,
                  undefined,
                  em,
                );
                await this.outbox.insertMany(
                  em,
                  message.pipelineRunId,
                  message.tenantId,
                  message.standalone ? [] : (r.emptySuccessors ?? []),
                );
              }
              return r;
            },
          );

          if (result.batches.length === 0) {
            this.logger.log(
              `${this.logicalStep}.dispatch: no batches; ${(result.emptySuccessors ?? []).length} empty-successor(s) staged to outbox`,
            );
            this.metrics.onConsumeEnd(
              message.tenantId,
              queue,
              'ok',
              (Date.now() - t0) / 1000,
            );
            return;
          }

          const countsPerQueue: Record<string, number> = {};
          for (const b of result.batches) {
            const q = b.queue ?? `${this.logicalStep}.batch`;
            countsPerQueue[q] = (countsPerQueue[q] ?? 0) + 1;
          }
          this.metrics.onDispatchBatches(
            message.tenantId,
            this.logicalStep,
            countsPerQueue,
          );
          if (this.logicalStep === PipelineStep.IMPORT_COMPETITOR_PRODUCTS) {
            const eansPerOrigin: Record<string, number> = {};
            for (const b of result.batches) {
              const p = b.payload as { origin?: string; eans?: string[] };
              if (p.origin && p.eans) {
                eansPerOrigin[p.origin] =
                  (eansPerOrigin[p.origin] ?? 0) + p.eans.length;
              }
            }
            this.metrics.onScrapeDispatch(message.tenantId, eansPerOrigin);
          }

          await this.runs.recordDispatch(
            message.pipelineRunId,
            this.logicalStep,
            result.batches.length,
          );
          const published = await this.emitBatches(message, result.batches);
          await this.runs.complete(message.pipelineRunId, this.logicalStep);
          const mode = this.config.pipelineDispatchOutboxPublish
            ? 'outbox-staged'
            : 'published';
          this.logger.log(
            `${this.logicalStep}.dispatch: ${mode} ${published}/${result.batches.length} batches`,
          );
          this.metrics.onConsumeEnd(
            message.tenantId,
            queue,
            'ok',
            (Date.now() - t0) / 1000,
          );
        } catch (err) {
          const errMessage = (err as Error).message || String(err);
          this.logger.error(
            `${this.logicalStep}.dispatch failed for run ${message.pipelineRunId}: ${errMessage}`,
          );
          this.metrics.onConsumeEnd(message.tenantId, queue, 'fail', 0);
          const outcome = await this.retry.republishOnFailure(message);
          await this.runs.fail(
            message.pipelineRunId,
            this.logicalStep,
            `${errMessage} (retry=${outcome})`,
          );
          // Don't re-throw: RetryService routed the message. Mark the
          // active span as ERROR so traces still show the failure.
          trace.getActiveSpan()?.recordException(err as Error);
          trace
            .getActiveSpan()
            ?.setStatus({ code: SpanStatusCode.ERROR, message: errMessage });
        }
      },
    );
  }

  /**
   * Publishes or outbox-stages batch messages, skipping batches already
   * completed (fan-in) or already published/staged (checkpoint).
   */
  private async emitBatches(
    message: PipelineMessage<TPayload>,
    batches: PipelineMessage<unknown>[],
  ): Promise<number> {
    const [done, from] = await Promise.all([
      this.runs.completedBatchSeqs(message.pipelineRunId, this.logicalStep),
      this.runs.lastPublishedBatchSeq(message.pipelineRunId, this.logicalStep),
    ]);
    const pending = batches.filter((b) => {
      const seq = b.batchSeq ?? 0;
      return seq > from && !done.has(seq);
    });
    if (pending.length === 0) return 0;

    const checkpoint = this.config.pipelineDispatchPublishCheckpoint;
    const publishTimeoutMs = this.config.pipelinePublishTimeoutMs;

    if (this.config.pipelineDispatchOutboxPublish) {
      let emitted = 0;
      for (let i = 0; i < pending.length; i += OUTBOX_INSERT_CHUNK) {
        const slice = pending.slice(i, i + OUTBOX_INSERT_CHUNK);
        const msgs = slice.map((b) => ({
          ...b,
          standalone: message.standalone,
        }));
        await this.outbox.insertBatchMessages(
          message.pipelineRunId,
          message.tenantId,
          msgs,
        );
        emitted += slice.length;
        const maxSeq = Math.max(...slice.map((b) => b.batchSeq ?? 0));
        await this.runs.updateLastPublishedBatchSeq(
          message.pipelineRunId,
          this.logicalStep,
          maxSeq,
        );
      }
      return emitted;
    }

    let emitted = 0;
    for (const batch of pending) {
      const seq = batch.batchSeq ?? 0;
      await this.publisher.publishStep(
        { ...batch, standalone: message.standalone },
        publishTimeoutMs,
        { producer: `dispatch:${this.logicalStep}`, count: 1 },
      );
      emitted++;
      if (checkpoint > 0 && seq % checkpoint === 0) {
        await this.runs.updateLastPublishedBatchSeq(
          message.pipelineRunId,
          this.logicalStep,
          seq,
        );
      }
    }
    const lastSeq = pending[pending.length - 1].batchSeq ?? 0;
    if (lastSeq > from) {
      await this.runs.updateLastPublishedBatchSeq(
        message.pipelineRunId,
        this.logicalStep,
        lastSeq,
      );
    }
    return emitted;
  }
}
