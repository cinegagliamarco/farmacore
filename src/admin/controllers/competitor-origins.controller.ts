import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import {
  CompetitorOriginAdminService,
  CompetitorOriginRow,
} from '../services/competitor-origin-admin.service';
import { UpdateCompetitorOriginsDto } from '../dto/update-competitor-origins.dto';

@Controller('admin/tenants/:slug/competitor-origins')
@UseGuards(SystemAdminGuard)
export class CompetitorOriginsController {
  constructor(private readonly svc: CompetitorOriginAdminService) {}

  @Get()
  public list(@Param('slug') slug: string): Promise<CompetitorOriginRow[]> {
    return this.svc.list(slug);
  }

  @Put()
  public bulkUpdate(
    @Param('slug') slug: string,
    @Body() dto: UpdateCompetitorOriginsDto,
  ): Promise<void> {
    return this.svc.bulkUpdate(slug, dto.origins);
  }
}
