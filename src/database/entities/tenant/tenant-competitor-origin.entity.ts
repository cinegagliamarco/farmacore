import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

@Entity({ name: 'tenant_competitor_origin' })
@Index('UQ_TENANT_COMP_ORIGIN', ['origin'], { unique: true })
export class TenantCompetitorOriginEntity extends BaseEntity {
  @Column({ type: 'text', enum: CompetitorOrigin })
  public origin!: CompetitorOrigin;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'int', default: 100 })
  public priority!: number;

  @Column({ type: 'jsonb', default: {} })
  public config!: Record<string, unknown>;
}
