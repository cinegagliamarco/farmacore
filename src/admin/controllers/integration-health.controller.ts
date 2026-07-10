import { Controller, Get, UseGuards } from '@nestjs/common';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import {
  IntegrationConnectionService,
  IntegrationHealthReport,
} from '../../integration/integration-connection.service';

/**
 * Fleet-wide view: pings every tenant's ERP database and reports each one's
 * reachability in a single call. Separate from `/health` (Fly's gate) — a
 * tenant ERP outage must never pull the API out of rotation.
 */
@Controller('admin/integrations')
@UseGuards(SystemAdminGuard)
export class IntegrationHealthController {
  constructor(private readonly svc: IntegrationConnectionService) {}

  @Get('health')
  public health(): Promise<IntegrationHealthReport> {
    return this.svc.testAll();
  }
}
