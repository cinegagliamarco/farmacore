import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';
import { OutboxRepository } from './outbox.repository';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { PipelinePublisher } from './pipeline-publisher.service';
import { TenantService } from '../tenant/tenant.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineMessage } from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

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
        return;
      }

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
          const r = await this.handle({ message, em, integrationDs });
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
              r.emptySuccessors ?? [],
            );
          }
          return r;
        },
      );

      if (result.batches.length === 0) {
        this.logger.log(
          `${this.logicalStep}.dispatch: no batches; ${(result.emptySuccessors ?? []).length} empty-successor(s) staged to outbox`,
        );
        return;
      }

      await this.runs.recordDispatch(
        message.pipelineRunId,
        this.logicalStep,
        result.batches.length,
      );
      for (const batch of result.batches) {
        await this.publisher.publishStep(batch);
      }
      await this.runs.complete(message.pipelineRunId, this.logicalStep);
      this.logger.log(
        `${this.logicalStep}.dispatch: published ${result.batches.length} batches`,
      );
    } catch (err) {
      const errMessage = (err as Error).message || String(err);
      this.logger.error(
        `${this.logicalStep}.dispatch failed for run ${message.pipelineRunId}: ${errMessage}`,
      );
      const outcome = await this.retry.republishOnFailure(message);
      await this.runs.fail(
        message.pipelineRunId,
        this.logicalStep,
        `${errMessage} (retry=${outcome})`,
      );
    }
  }
}
