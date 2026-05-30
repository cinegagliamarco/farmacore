import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../database/enums/user-role.enum';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { CompetitorOriginAdminService } from '../services/competitor-origin-admin.service';
import { UpdateCompetitorOriginsDto } from '../dto/update-competitor-origins.dto';

@Controller('admin/tenants/:slug/competitor-origins')
@UseGuards(SystemAdminGuard)
@Roles(UserRole.ADMIN)
export class CompetitorOriginsController {
  constructor(private readonly svc: CompetitorOriginAdminService) {}

  @Put()
  public bulkUpdate(
    @Param('slug') slug: string,
    @Body() dto: UpdateCompetitorOriginsDto,
  ): Promise<void> {
    return this.svc.bulkUpdate(slug, dto.origins);
  }
}
