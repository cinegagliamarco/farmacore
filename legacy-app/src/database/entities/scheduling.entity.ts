import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SchedulingAction } from '../../common/scheduling-action.enum';
import { BaseProductTypeormEntity } from './base-product.entity';
import { BaseTypeormModel } from './base.typeorm-model';

@Entity('scheduling')
@Index('IDX_SCHEDULING_EXECUTION_DATE', ['executionDate'])
@Index('IDX_SCHEDULING_EXECUTED', ['executed'])
@Index('IDX_SCHEDULING_BASE_PRODUCT_ID', ['baseProductId'])
export class SchedulingTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'timestamptz', nullable: false, name: 'execution_date' })
  public executionDate: Date;

  @Column({ type: 'integer', nullable: false, name: 'base_product_id' })
  public baseProductId: number;

  @ManyToOne(() => BaseProductTypeormEntity, { nullable: false })
  @JoinColumn({
    name: 'base_product_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_scheduling_base_product'
  })
  public baseProduct: BaseProductTypeormEntity;

  @Column({
    type: 'enum',
    enum: SchedulingAction,
    enumName: 'scheduling_action_enum',
    nullable: false
  })
  public action: SchedulingAction;

  @Column({ type: 'text', nullable: false })
  public value: string;

  @Column({ type: 'boolean', default: false, nullable: false })
  public executed: boolean;

  @Column({ type: 'text', nullable: true })
  public error?: string;
}

