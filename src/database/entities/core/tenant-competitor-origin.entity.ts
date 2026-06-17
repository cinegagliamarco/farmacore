import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

/**
 * Per-tenant competitor-scrape config. Control-plane data (which origins
 * a tenant scrapes, and their priority), so it lives in `core` next to
 * the tenant + its integration connection — not in the tenant schema,
 * which holds operational data (products, stock, overrides).
 */
@Entity({ schema: 'core', name: 'tenant_competitor_origin' })
@Index('UQ_TENANT_COMPETITOR_ORIGIN', ['tenantId', 'origin'], { unique: true })
export class TenantCompetitorOriginEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ type: 'text', enum: CompetitorOrigin })
  public origin!: CompetitorOrigin;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'int', default: 100 })
  public priority!: number;

  @Column({ type: 'jsonb', default: {} })
  public config!: Record<string, unknown>;
}
