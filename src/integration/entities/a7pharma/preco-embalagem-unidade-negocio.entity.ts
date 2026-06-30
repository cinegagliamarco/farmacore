import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { NumericColumn } from '../numeric-column.decorator';

/**
 * A7Pharma per-store sell price override for an embalagem. Read-only
 * source for product_item.price; falls back to embalagem.precovenda
 * (global/base) when a store has no override row.
 */
@Entity({
  name: 'precoembalagemunidadenegocio',
  schema: 'public',
  synchronize: false,
})
@Index('idx_precoembalagemunidadenegocio_embalagemid', ['embalagemid'])
@Index('idx_precoembalagemunidadenegocio_unidadenegocioid', [
  'unidadenegocioid',
])
@Index(
  'uidx_precoembalagemunidadenegocio_embalagemid_unidadenegocioid',
  ['embalagemid', 'unidadenegocioid'],
  { unique: true },
)
export class PrecoEmbalagemUnidadeNegocioEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'bigint', name: 'embalagemid', nullable: false })
  public embalagemid!: number;

  @Column({ type: 'bigint', name: 'unidadenegocioid', nullable: false })
  public unidadenegocioid!: number;

  @NumericColumn({
    precision: 15,
    scale: 4,
    name: 'precovenda',
    nullable: false,
  })
  public precovenda!: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'markup', nullable: true })
  public markup?: number;

  @NumericColumn({
    precision: 15,
    scale: 4,
    name: 'precoreferencial',
    nullable: true,
  })
  public precoreferencial?: number;
}
