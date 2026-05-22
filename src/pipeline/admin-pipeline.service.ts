import { Injectable } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { PipelinePublisher } from '../queue/pipeline-publisher.service';

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
    });
    return { pipelineRunId };
  }
}
