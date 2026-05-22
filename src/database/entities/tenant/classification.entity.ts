import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'classification' })
@Index('IX_CLASSIFICATION_PARENT', ['parentId'])
export class ClassificationEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  public parentId?: string | null;

  @Column({ type: 'boolean', default: true })
  public visible!: boolean;
}
