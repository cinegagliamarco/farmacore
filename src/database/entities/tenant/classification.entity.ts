import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { ProductEntity } from './product.entity';

@Entity({ name: 'classification' })
@Index('IX_CLASSIFICATION_PARENT', ['parentId'])
export class ClassificationEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  public parentId?: string | null;

  @Column({ type: 'boolean', default: true })
  public visible!: boolean;

  @ManyToOne(() => ClassificationEntity, (parent) => parent.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_id' })
  public parent?: ClassificationEntity | null;

  @OneToMany(() => ClassificationEntity, (child) => child.parent)
  public children?: ClassificationEntity[];

  @OneToMany(() => ProductEntity, (product) => product.classification)
  public products?: ProductEntity[];
}
