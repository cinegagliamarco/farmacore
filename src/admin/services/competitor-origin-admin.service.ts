import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantService } from '../../tenant/tenant.service';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { originLabel } from '../../database/competitor-origin.registry';
import { CompetitorOriginUpdate } from '../dto/update-competitor-origins.dto';

export interface CompetitorOriginRow {
  origin: CompetitorOrigin;
  label: string;
  enabled: boolean;
  priority: number;
}

@Injectable()
export class CompetitorOriginAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenants: TenantService,
  ) {}

  public async list(slug: string): Promise<CompetitorOriginRow[]> {
    const tenant = await this.tenants.findActive(slug);
    const rows: Array<{
      origin: CompetitorOrigin;
      enabled: boolean;
      priority: number;
    }> = await this.dataSource.query(
      `SELECT origin, enabled, priority
         FROM core.tenant_competitor_origin
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY priority ASC, origin ASC`,
      [tenant.id],
    );
    return rows.map((r) => ({ ...r, label: originLabel(r.origin) }));
  }

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
           WHERE tenant_id = $4 AND origin = $5 AND deleted_at IS NULL`,
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
