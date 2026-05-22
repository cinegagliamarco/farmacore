import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'status_settings' })
export class StatusSettingsEntity extends BaseEntity {
  @Column({ type: 'jsonb', default: {} })
  public settings!: Record<string, unknown>;
}
