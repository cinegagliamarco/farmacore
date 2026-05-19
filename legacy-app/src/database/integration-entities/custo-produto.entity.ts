import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { NumericColumn } from '../entities/numeric.decorator';

@Entity('custoproduto', { schema: 'public' })
@Index('cidx_custoproduto_historicocustoid', ['historicocustoid'])
@Index('idx_custoproduto_itemnotafiscalid', ['itemnotafiscalid'])
@Index('idx_custoproduto_unidadenegocioid', ['unidadenegocioid'])
@Index('uidx_custoproduto_produtoid_unidadenegocioid', ['produtoid', 'unidadenegocioid'], { unique: true })
export class CustoProdutoTypeormEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id: number;

  @Column({ type: 'bigint', name: 'produtoid', nullable: false })
  public produtoid: number;

  @Column({ type: 'bigint', name: 'unidadenegocioid', nullable: false })
  public unidadenegocioid: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'custo', nullable: false })
  public custo: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'customedio', nullable: false })
  public customedio: number;

  @Column({ type: 'bigint', name: 'itemnotafiscalid', nullable: true })
  public itemnotafiscalid?: number;

  @Column({ type: 'bigint', name: 'historicocustoid', nullable: true })
  public historicocustoid?: number;

  @Column({ type: 'timestamp', precision: 0, name: 'datahorainiciocalculocustomedio', nullable: true })
  public datahorainiciocalculocustomedio?: Date;
}

