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

export interface HandleResult {
  successors: PipelineMessage[];
}

export interface HandleContext {
  message: PipelineMessage<unknown>;
  em: EntityManager;
  integrationDs: DataSource | null;
}

@Injectable()
export abstract class BasePipelineConsumer<TPayload = unknown> {
  protected abstract readonly step: PipelineStep;
  protected readonly logger = new Logger(this.constructor.name);

  // Property injection so the concrete consumer subclasses don't need
  // to thread OutboxRepository through their super() calls.
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

  protected abstract handle(ctx: HandleContext): Promise<HandleResult>;

  public async process(message: PipelineMessage<TPayload>): Promise<void> {
    const queue = message.queue ?? this.step;
    await withPipelineSpan(
      {
        tenantId: message.tenantId,
        pipelineRunId: message.pipelineRunId,
        step: this.step,
        attempt: message.attempt,
      },
      async () => {
        try {
          const outcome = await this.runs.start(
            message.pipelineRunId,
            message.tenantId,
            this.step,
            message.attempt,
          );
          if (outcome === 'already-completed') {
            this.logger.debug(
              `Skipping ${this.step} for run ${message.pipelineRunId}: already completed`,
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
            // catch: its runs.fail() would clobber the original
            // delivery's RUNNING row (COMPLETED→FAILED flip).
            this.logger.warn(
              `${this.step} for run ${message.pipelineRunId} is already in progress; duplicate delivery routed to DLQ for replay`,
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

          // Handle + complete + successor staging in ONE tenant tx,
          // mirroring BatchPipelineConsumer: a crash between complete and
          // publish can no longer strand the chain (bug #1 window 2) —
          // OutboxPublisher drains the staged successors after commit.
          await this.tx.runWithTenant(tenant.schemaName, async (em) => {
            const result = await this.handle({
              message: message,
              em,
              integrationDs,
            });
            await this.runs.complete(
              message.pipelineRunId,
              this.step,
              undefined,
              em,
            );
            await this.outbox.insertMany(
              em,
              message.pipelineRunId,
              message.tenantId,
              message.standalone ? [] : result.successors,
            );
          });

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
            `${this.step} failed for run ${message.pipelineRunId}: ${errMessage}`,
          );
          this.metrics.onConsumeEnd(message.tenantId, queue, 'fail', 0);
          const outcome = await this.retry.republishOnFailure(message);
          await this.runs.fail(
            message.pipelineRunId,
            this.step,
            `${errMessage} (retry=${outcome})`,
          );
          // Don't re-throw: RetryService routed the message. Record the
          // failure on the active span so traces show ERROR status, but
          // returning normally lets @golevelup ACK the original.
          trace.getActiveSpan()?.recordException(err as Error);
          trace
            .getActiveSpan()
            ?.setStatus({ code: SpanStatusCode.ERROR, message: errMessage });
        }
      },
    );
  }
}
