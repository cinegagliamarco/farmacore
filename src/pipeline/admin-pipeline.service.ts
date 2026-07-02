import { Injectable } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { PipelinePublisher } from '../queue/pipeline-publisher.service';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

@Injectable()
export class AdminPipelineService {
  constructor(
    private readonly tenants: TenantService,
    private readonly publisher: PipelinePublisher,
  ) {}

  public async startForTenant(
    tenantSlug: string,
    userId: string,
  ): Promise<{ pipelineRunId: string }> {
    await this.tenants.findActive(tenantSlug);
    const pipelineRunId = await this.publisher.publishStart(tenantSlug, {
      reason: 'manual',
      startedBy: userId,
    }, { producer: 'admin:pipeline-start' });
    return { pipelineRunId };
  }

  /** Run one routine in isolation (no chaining into the rest of the graph). */
  public async triggerStep(
    tenantSlug: string,
    step: PipelineStep,
  ): Promise<{ pipelineRunId: string; step: PipelineStep }> {
    await this.tenants.findActive(tenantSlug);
    const pipelineRunId = await this.publisher.publishSingleStep(
      tenantSlug,
      step,
      { producer: 'admin:trigger-step' },
    );
    return { pipelineRunId, step };
  }
}
