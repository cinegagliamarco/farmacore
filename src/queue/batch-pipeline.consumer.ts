import { Inject, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { EntityManager, DataSource } from 'typeorm';
import { OutboxRepository } from './outbox.repository';
import { PipelineRunService } from './pipeline-run.service';
import { DuplicateDeliveryRepublishError, RetryService } from './retry.service';
import { TenantService } from '../tenant/tenant.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { withPipelineSpan } from '../observability/pipeline-span.helper';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';
import { PipelineMessage } from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { TenantEntity } from '../database/entities/core/tenant.entity';

export interface BatchHandleContext<TPayload = unknown> {
  message: PipelineMessage<TPayload>;
  em: EntityManager;
  integrationDs: DataSource | null;
  batchSeq: number;
  tenant: TenantEntity;
}

export interface LastBatchContext<TPayload = unknown> {
  message: PipelineMessage<TPayload>;
  em: EntityManager;
  integrationDs: DataSource | null;
}

/**
 * Base class for a per-batch consumer in the v2 dispatcher/batch topology.
 *
 * The dispatcher emits N messages with batchSeq 1..N. Each batch:
 *   1. Idempotency-checks (runId, step, batchSeq) via PipelineRunService.start.
 *   2. Runs handle() inside the tenant transaction.
 *   3. Records completion of its own batch row.
 *   4. Atomically increments batches_done on the step's dispatch row
 *      (batch_seq=0). The batch that observes done == planned is the
 *      LAST one and publishes the successors returned by handle().
 *
 * `logicalStep` is the dependency-graph unit (e.g. SYNC_BASE_PRODUCT).
 * The queue / routing key are owned by the concrete @RabbitSubscribe
 * decorator on the subclass (e.g. 'sync-base-product.batch').
 */
@Injectable()
export abstract class BatchPipelineConsumer<TPayload = unknown> {
  protected abstract readonly logicalStep: PipelineStep;
  protected readonly logger = new Logger(this.constructor.name);

  // Property injection so the 13+ concrete consumer subclasses don't
  // need to thread OutboxRepository through their super() calls.
  @Inject(OutboxRepository)
  protected readonly outbox!: OutboxRepository;

  @Inject(PipelineMetricsRegistry)
  protected readonly metrics!: PipelineMetricsRegistry;

  constructor(
    protected readonly runs: PipelineRunService,
    protected readonly retry: RetryService,
    protected readonly tx: TenantTransactionService,
    protected readonly tenants: TenantService,
    protected readonly integrationFactory: IntegrationDataSourceFactory,
  ) {}

  /**
   * Per-batch work. Runs inside the tenant transaction. Returning
   * normally means the batch succeeded; throwing routes to retry/DLQ.
   */
  protected abstract handle(ctx: BatchHandleContext<TPayload>): Promise<void>;

  /**
   * Successors to publish when this batch closes the fan-in counter.
   * Called only on the LAST batch; called inside a fresh tenant
   * transaction so the subclass can consult the tenant schema (e.g. a
   * join service) when deciding what to publish. Returning [] is
   * legal — useful for branches that wait on a sibling step.
   */
  protected abstract successors(
    ctx: LastBatchContext<TPayload>,
  ): Promise<PipelineMessage<unknown>[]>;

  public async process(message: PipelineMessage<TPayload>): Promise<void> {
    const batchSeq = message.batchSeq ?? 0;
    const queue = message.queue ?? this.logicalStep;
    await withPipelineSpan(
      {
        tenantId: message.tenantId,
        pipelineRunId: message.pipelineRunId,
        step: this.logicalStep,
        attempt: message.attempt,
        batchSeq,
      },
      async () => {
        try {
          if (batchSeq <= 0) {
            throw new Error(
              `BatchPipelineConsumer requires batchSeq >= 1 (got ${batchSeq}) for step ${this.logicalStep}`,
            );
          }
          const outcome = await this.runs.start(
            message.pipelineRunId,
            message.tenantId,
            this.logicalStep,
            message.attempt,
            batchSeq,
          );
          if (outcome === 'already-completed') {
            this.logger.debug(
              `Skipping ${this.logicalStep}#${batchSeq} for run ${message.pipelineRunId}: already completed`,
            );
            // start+end pair: a bare 'skip' end would decrement the
            // original delivery's in-flight gauge and close its wave early.
            this.metrics.onConsumeStart(message.tenantId, queue);
            this.metrics.onConsumeEnd(message.tenantId, queue, 'skip', 0);
            return;
          }
          if (outcome === 'in-progress') {
            // Duplicate delivery while the original may still be
            // executing (broker requeue after a heartbeat stall). Ack
            // would silently drop it — if the previous worker actually
            // crashed the run would stall — so route it to the DLQ for
            // replay. Straight to the DLQ, NOT through the generic
            // catch: its runs.fail() would flip the original delivery's
            // RUNNING batch row to FAILED, making its
            // completeBatchAndIncrement CTE (WHERE status='running')
            // match nothing — the fan-in counter never closes and the
            // run stalls with all work committed.
            this.logger.warn(
              `${this.logicalStep}#${batchSeq} for run ${message.pipelineRunId} is already in progress; duplicate delivery routed to DLQ for replay`,
            );
            this.metrics.onConsumeStart(message.tenantId, queue);
            this.metrics.onConsumeEnd(message.tenantId, queue, 'skip', 0);
            try {
              await this.retry.republishOnFailure(message);
            } catch (republishErr) {
              // Republish failed (e.g. channel drop right after the
              // reconnect that caused this redelivery): rethrow PAST the
              // generic catch so golevelup nacks and the broker itself
              // dead-letters via the queue's DLX.
              throw new DuplicateDeliveryRepublishError(
                (republishErr as Error).message,
              );
            }
            return;
          }

          this.metrics.onConsumeStart(message.tenantId, queue);
          const t0 = Date.now();

          const tenant = await this.tenants.findActive(message.tenantId);
          const integrationDs = await this.integrationFactory.forTenantSlug(
            tenant.slug,
          );

          // Handle + complete + counter increment + (last-batch) outbox
          // staging all in ONE tenant tx. The atomic CTE closes the
          // complete↔counter deadlock (bug #1 window 1); the outbox
          // insert closes the counter↔publish gap (bug #1 window 2).
          // OutboxPublisher drains the outbox + actually publishes to AMQP.
          const inc = await this.tx.runWithTenant(
            tenant.schemaName,
            async (em) => {
              await this.handle({
                message,
                em,
                integrationDs,
                batchSeq,
                tenant,
              });
              const incResult = await this.runs.completeBatchAndIncrement(
                em,
                message.pipelineRunId,
                this.logicalStep,
                batchSeq,
              );
              if (incResult.isLast) {
                const successors = message.standalone
                  ? []
                  : await this.successors({
                      message,
                      em,
                      integrationDs,
                    });
                await this.outbox.insertMany(
                  em,
                  message.pipelineRunId,
                  message.tenantId,
                  successors,
                );
              }
              return incResult;
            },
          );

          if (inc.isLast) {
            this.logger.log(
              `${this.logicalStep} fan-in complete (${inc.done}/${inc.planned}); successors staged to outbox`,
            );
          } else {
            this.logger.debug(
              `${this.logicalStep}#${batchSeq} done (${inc.done}/${inc.planned})`,
            );
          }
          this.metrics.onConsumeEnd(
            message.tenantId,
            queue,
            'ok',
            (Date.now() - t0) / 1000,
          );
        } catch (err) {
          if (err instanceof DuplicateDeliveryRepublishError) throw err;
          const errMessage = (err as Error).message || String(err);
          this.logger.error(
            `${this.logicalStep}#${batchSeq} failed for run ${message.pipelineRunId}: ${errMessage}`,
          );
          this.metrics.onConsumeEnd(message.tenantId, queue, 'fail', 0);
          const outcome = await this.retry.republishOnFailure(message);
          await this.runs.fail(
            message.pipelineRunId,
            this.logicalStep,
            `${errMessage} (retry=${outcome})`,
            batchSeq,
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
}
