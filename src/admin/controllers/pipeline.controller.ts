import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AdminPipelineService } from '../../pipeline/admin-pipeline.service';
import type { JwtPayload } from '../../auth/jwt-payload.type';

@Controller('admin/tenants/:slug/pipeline')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class PipelineController {
  constructor(private readonly svc: AdminPipelineService) {}

  @Post('start')
  public start(
    @Param('slug') slug: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ pipelineRunId: string }> {
    return this.svc.startForTenant(slug, user.sub);
  }
}
