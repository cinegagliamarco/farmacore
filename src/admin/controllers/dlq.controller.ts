import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../database/enums/user-role.enum';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { DlqService } from '../services/dlq.service';

@Controller('admin/dlq')
@UseGuards(SystemAdminGuard)
@Roles(UserRole.ADMIN)
export class DlqController {
  constructor(private readonly svc: DlqService) {}

  /** List every queue whose DLQ can be peeked/replayed. */
  @Get()
  public list(): { queues: string[] } {
    return { queues: this.svc.listQueues() };
  }

  @Get(':queue')
  public peek(
    @Param('queue') queue: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.peek(queue, limit);
  }

  @Post(':queue/replay')
  public replay(
    @Param('queue') queue: string,
    @Query('max', new DefaultValuePipe(100), ParseIntPipe) max: number,
  ) {
    return this.svc.replay(queue, max);
  }
}
