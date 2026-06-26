import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { NumericColumn } from '../numeric-column.decorator';
import { ItemCadernoOfertaEntity } from './item-caderno-oferta.entity';

@Entity({
  name: 'itemcadernoofertaquantidade',
  schema: 'public',
  synchronize: false,
})
@Index(
  'uidx_itemcadernoofertaquantidade_itemcadernoofertaid_quantidade',
  ['itemcadernoofertaid', 'quantidade'],
  { unique: true },
)
export class ItemCadernoOfertaQuantidadeEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'bigint', name: 'itemcadernoofertaid', nullable: false })
  public itemcadernoofertaid!: number;

  @Column({ type: 'int', name: 'quantidade', nullable: false })
  public quantidade!: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'desconto', nullable: true })
  public desconto?: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'preco', nullable: true })
  public preco?: number;

  @NumericColumn({
    precision: 15,
    scale: 4,
    name: 'precototal',
    nullable: true,
  })
  public precototal?: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'markup', nullable: true })
  public markup?: number;

  @NumericColumn({
    precision: 15,
    scale: 4,
    name: 'descontototal',
    nullable: true,
  })
  public descontototal?: number;

  @NumericColumn({
    precision: 15,
    scale: 4,
    name: 'descontofixo',
    nullable: true,
  })
  public descontofixo?: number;

  @ManyToOne(() => ItemCadernoOfertaEntity, (item) => item.quantidades, {
    nullable: false,
  })
  @JoinColumn({ name: 'itemcadernoofertaid', referencedColumnName: 'id' })
  public itemcadernooferta?: ItemCadernoOfertaEntity;
}
