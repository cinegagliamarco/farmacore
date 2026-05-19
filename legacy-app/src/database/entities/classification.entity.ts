import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { BaseProductTypeormEntity } from './base-product.entity';

@Entity('classification')
@Index('IDX_CLASSIFICATION_NAME', ['name'])
export class ClassificationTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'text', nullable: false, unique: true })
  public name: string;

  @OneToMany(() => BaseProductTypeormEntity, (baseProduct) => baseProduct.classificationEntity)
  public baseProducts: BaseProductTypeormEntity[];
}
