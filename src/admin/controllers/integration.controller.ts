import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { UpsertIntegrationDto } from '../../integration/dto/upsert-integration.dto';

@Controller('admin/tenants/:slug/integration')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class IntegrationController {
  constructor(private readonly svc: IntegrationConnectionService) {}

  @Put()
  public async upsert(
    @Param('slug') slug: string,
    @Body() dto: UpsertIntegrationDto,
  ): Promise<{ status: string }> {
    const row = await this.svc.upsert(slug, dto);
    return { status: row.status };
  }

  @Post('test')
  public test(
    @Param('slug') slug: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.svc.test(slug);
  }

  @Delete()
  public disable(@Param('slug') slug: string): Promise<void> {
    return this.svc.disable(slug);
  }
}
