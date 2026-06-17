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

  constructor(
    protected readonly runs: PipelineRunService,
    protected readonly retry: RetryService,
    protected readonly tx: TenantTransactionService,
    protected readonly tenants: TenantService,
    protected readonly integrationFactory: IntegrationDataSourceFactory,
    protected readonly publisher: PipelinePublisher,
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
            return;
          }
          if (outcome === 'in-progress') {
            throw new Error(
              `In-progress lock held for ${this.logicalStep}#${batchSeq} run ${message.pipelineRunId}`,
            );
          }

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
        } catch (err) {
          const errMessage = (err as Error).message || String(err);
          this.logger.error(
            `${this.logicalStep}#${batchSeq} failed for run ${message.pipelineRunId}: ${errMessage}`,
          );
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
