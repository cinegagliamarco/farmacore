import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantService } from '../../tenant/tenant.service';
import { CompetitorOriginUpdate } from '../dto/update-competitor-origins.dto';

@Injectable()
export class CompetitorOriginAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenants: TenantService,
  ) {}

  public async bulkUpdate(
    slug: string,
    updates: CompetitorOriginUpdate[],
  ): Promise<void> {
    const tenant = await this.tenants.findActive(slug);
    await this.dataSource.transaction(async (em) => {
      for (const u of updates) {
        await em.query(
          `UPDATE core.tenant_competitor_origin
             SET enabled = $1,
                 priority = COALESCE($2, priority),
                 config = COALESCE($3, config),
                 updated_at = now()
           WHERE tenant_id = $4 AND origin = $5`,
          [
            u.enabled,
            u.priority ?? null,
            u.config ? JSON.stringify(u.config) : null,
            tenant.id,
            u.origin,
          ],
        );
      }
    });
  }
}
