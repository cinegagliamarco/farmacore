import { Injectable } from '@nestjs/common';
import {
  MessageHandlerErrorBehavior,
  RabbitSubscribe,
} from '@golevelup/nestjs-rabbitmq';
import {
  BasePipelineConsumer,
  HandleContext,
  HandleResult,
} from '../../queue/base-pipeline.consumer';
import { EXCHANGE_NAME } from '../../queue/constants';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ExecuteOfferBookRuleStep } from '../steps/execute-offer-book-rule.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';

/**
 * Execução de regra de oferta (standalone, fora do DAG diário).
 * `pipelineRunId` = report.id (como o apply usa applyRunId). O step segura um
 * advisory lock por toda a entrega, porque o lease genérico pode vencer antes
 * de uma regra grande; o ledger `pending|erp_applied` torna o replay seguro.
 */
@Injectable()
export class ExecuteOfferBookRuleConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.EXECUTE_OFFER_BOOK_RULE;

  constructor(
    private readonly stepImpl: ExecuteOfferBookRuleStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${PipelineStep.EXECUTE_OFFER_BOOK_RULE}`,
    createQueueIfNotExists: false,
    queue: PipelineStep.EXECUTE_OFFER_BOOK_RULE,
    queueOptions: {
      channel: PipelineStep.EXECUTE_OFFER_BOOK_RULE,
    },
    // DuplicateDeliveryRepublishError precisa ir para a DLX; o default da
    // lib é REQUEUE e criaria hot-loop numa fila prefetch=1.
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  })
  public consume(message: PipelineMessage): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: HandleContext): Promise<HandleResult> {
    await this.stepImpl.run(
      ctx.em,
      ctx.message.tenantId,
      ctx.message.pipelineRunId,
    );
    return { successors: [] };
  }
}
