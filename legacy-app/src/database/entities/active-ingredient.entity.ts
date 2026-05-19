import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseProductTypeormEntity } from './base-product.entity';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';

@Entity('active_ingredient')
export class ActiveIngredientTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'text', nullable: false, unique: true })
  public name: string;

  @Column({ type: 'bigint', nullable: true, unique: true, name: 'external_id' })
  public externalId: number;

  @NumericColumn({ precision: 10, scale: 2, nullable: false, default: 0 })
  public mat: number;

  @OneToMany(() => BaseProductTypeormEntity, (baseProduct) => baseProduct.activeIngredientEntity)
  public baseProducts: BaseProductTypeormEntity[];
}
