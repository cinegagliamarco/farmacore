import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { CreateScheduleDto } from './dto/schedule.dto';
import {
  PricingScheduleService,
  ScheduleView,
} from './pricing-schedule.service';

/**
 * Agendamentos de aplicação de preço (one-shot). O cron dispara em `runAt`.
 * Mutações exigem operator/admin.
 */
@Controller('pricing/schedules')
export class PricingScheduleController {
  constructor(private readonly schedules: PricingScheduleService) {}

  @Get()
  public list(@TenantEm() em: EntityManager): Promise<ScheduleView[]> {
    return this.schedules.list(em);
  }

  @Get(':id')
  public get(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ScheduleView> {
    return this.schedules.get(em, id);
  }

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public create(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateScheduleDto,
  ): Promise<ScheduleView> {
    return this.schedules.create(em, user.sub, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public cancel(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; cancelled: boolean }> {
    return this.schedules.cancel(em, id);
  }
}
