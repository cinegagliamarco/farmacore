import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { PipelinePublisher } from './pipeline-publisher.service';
import { TenantService } from '../tenant/tenant.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
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

  constructor(
    protected readonly runs: PipelineRunService,
    protected readonly retry: RetryService,
    protected readonly tx: TenantTransactionService,
    protected readonly tenants: TenantService,
    protected readonly integrationFactory: IntegrationDataSourceFactory,
    protected readonly publisher: PipelinePublisher,
  ) {}

  protected abstract handle(ctx: HandleContext): Promise<HandleResult>;

  public async process(message: PipelineMessage<TPayload>): Promise<void> {
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
        return;
      }
      if (outcome === 'in-progress') {
        throw new Error(
          `In-progress lock held for ${this.step} run ${message.pipelineRunId}`,
        );
      }

      const tenant = await this.tenants.findActive(message.tenantId);
      const integrationDs = await this.integrationFactory.forTenantSlug(
        tenant.slug,
      );

      const result = await this.tx.runWithTenant(tenant.schemaName, (em) =>
        this.handle({
          message: message,
          em,
          integrationDs,
        }),
      );

      await this.runs.complete(message.pipelineRunId, this.step);

      for (const successor of result.successors) {
        await this.publisher.publishStep(successor);
      }
    } catch (err) {
      const errMessage = (err as Error).message || String(err);
      this.logger.error(
        `${this.step} failed for run ${message.pipelineRunId}: ${errMessage}`,
      );
      const outcome = await this.retry.republishOnFailure(message);
      await this.runs.fail(
        message.pipelineRunId,
        this.step,
        `${errMessage} (retry=${outcome})`,
      );
    }
  }
}
