import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

@Entity({ name: 'tenant_product_override' })
@Index('UQ_TENANT_OVERRIDE_EAN_ORIGIN', ['ean', 'origin'], { unique: true })
@Index('IX_TENANT_OVERRIDE_EAN', ['ean'])
export class TenantProductOverrideEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text', enum: CompetitorOrigin })
  public origin!: CompetitorOrigin;

  @Column({ type: 'boolean', default: false })
  public monitored!: boolean;

  @Column({ type: 'text', nullable: true })
  public notes?: string | null;

  @Column({ type: 'jsonb', default: {} })
  public overrides!: Record<string, unknown>;
}
