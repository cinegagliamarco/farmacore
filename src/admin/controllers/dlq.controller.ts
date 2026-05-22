import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { DlqService } from '../services/dlq.service';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';

@Controller('admin/dlq')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class DlqController {
  constructor(private readonly svc: DlqService) {}

  @Get(':step')
  public peek(
    @Param('step', new ParseEnumPipe(PipelineStep)) step: PipelineStep,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.peek(step, limit);
  }

  @Post(':step/replay')
  public replay(
    @Param('step', new ParseEnumPipe(PipelineStep)) step: PipelineStep,
    @Query('max', new DefaultValuePipe(100), ParseIntPipe) max: number,
  ) {
    return this.svc.replay(step, max);
  }
}
