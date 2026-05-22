import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantStatus } from '../../enums/tenant-status.enum';

@Entity({ schema: 'core', name: 'tenant' })
@Index('UQ_TENANT_SLUG', ['slug'], { unique: true })
@Index('UQ_TENANT_SCHEMA_NAME', ['schemaName'], { unique: true })
export class TenantEntity extends BaseEntity {
  @Column({ type: 'text' })
  public slug!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text', name: 'schema_name' })
  public schemaName!: string;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.ACTIVE })
  public status!: TenantStatus;
}
