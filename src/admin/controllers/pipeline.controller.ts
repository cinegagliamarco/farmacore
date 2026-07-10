import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AdminPipelineService } from '../../pipeline/admin-pipeline.service';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import type { JwtPayload } from '../../auth/jwt-payload.type';

const TRIGGERABLE_STEPS = Object.values(PipelineStep);

@Controller('admin/tenants/:slug/pipeline')
@UseGuards(SystemAdminGuard)
export class PipelineController {
  constructor(private readonly svc: AdminPipelineService) {}

  /** Kick off the full daily pipeline (chains the whole step graph). */
  @Post('start')
  public start(
    @Param('slug') slug: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ pipelineRunId: string }> {
    return this.svc.startForTenant(slug, user.sub);
  }

  /** List the routines an admin can trigger individually. */
  @Get('steps')
  public steps(): { steps: PipelineStep[] } {
    return { steps: TRIGGERABLE_STEPS };
  }

  /** Run a single routine in isolation (no chaining to downstream steps). */
  @Post('steps/:step')
  public triggerStep(
    @Param('slug') slug: string,
    @Param('step') step: string,
  ): Promise<{ pipelineRunId: string; step: PipelineStep }> {
    if (!TRIGGERABLE_STEPS.includes(step as PipelineStep)) {
      throw new BadRequestException(
        `Unknown step "${step}". Valid: ${TRIGGERABLE_STEPS.join(', ')}`,
      );
    }
    return this.svc.triggerStep(slug, step as PipelineStep);
  }
}
