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
      await em.query(
        `SET LOCAL search_path TO "${tenant.schemaName}", shared_catalog, public`,
      );
      for (const u of updates) {
        await em.query(
          `UPDATE tenant_competitor_origin
             SET enabled = $1,
                 priority = COALESCE($2, priority),
                 config = COALESCE($3, config),
                 updated_at = now()
           WHERE origin = $4`,
          [
            u.enabled,
            u.priority ?? null,
            u.config ? JSON.stringify(u.config) : null,
            u.origin,
          ],
        );
      }
    });
  }
}
