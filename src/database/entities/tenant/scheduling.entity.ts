import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'scheduling' })
export class SchedulingEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ name: 'cron_expression', type: 'text' })
  public cronExpression!: string;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'jsonb', default: {} })
  public payload!: Record<string, unknown>;
}
