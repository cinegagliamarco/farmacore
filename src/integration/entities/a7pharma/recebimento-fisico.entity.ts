import { Column, Entity, Index, OneToMany, PrimaryColumn } from 'typeorm';
import type { ItemRecebimentoFisicoEntity } from './item-recebimento-fisico.entity';

@Entity({ name: 'recebimentofisico', schema: 'public', synchronize: false })
@Index('idx_recebimentofisico_datahora_unidadenegocioid', [
  'datahora',
  'unidadenegocioid',
])
@Index('idx_recebimentofisico_datahorafinal_unidadenegocioid', [
  'datahorafinal',
  'unidadenegocioid',
])
export class RecebimentoFisicoEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'int', name: 'codigo', nullable: false })
  public codigo!: number;

  @Column({
    type: 'char',
    length: 1,
    name: 'status',
    nullable: false,
    default: 'A',
  })
  public status!: string;

  @Column({ type: 'bigint', name: 'unidadenegocioid', nullable: false })
  public unidadenegocioid!: number;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datahora',
    nullable: false,
  })
  public datahora!: Date;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datahorafinal',
    nullable: true,
  })
  public datahorafinal?: Date;

  @Column({ type: 'bigint', name: 'usuarioid', nullable: false })
  public usuarioid!: number;

  @Column({
    type: 'bigint',
    name: 'liberacaousuariosempedidoid',
    nullable: true,
  })
  public liberacaousuariosempedidoid?: number;

  @Column({
    type: 'bigint',
    name: 'liberacaousuariocomdivergenciaid',
    nullable: true,
  })
  public liberacaousuariocomdivergenciaid?: number;

  @Column({
    type: 'bigint',
    name: 'liberacaousuariosuspensocompraid',
    nullable: true,
  })
  public liberacaousuariosuspensocompraid?: number;

  @Column({
    type: 'bigint',
    name: 'liberacaousuarioitensinativosid',
    nullable: true,
  })
  public liberacaousuarioitensinativosid?: number;

  @Column({
    type: 'bigint',
    name: 'liberacaousuariosemelhancapedidocompraid',
    nullable: true,
  })
  public liberacaousuariosemelhancapedidocompraid?: number;

  @Column({
    type: 'bigint',
    name: 'liberacaousuarionotafiscalcomocorrenciasid',
    nullable: true,
  })
  public liberacaousuarionotafiscalcomocorrenciasid?: number;

  @OneToMany('ItemRecebimentoFisicoEntity', 'recebimentofisico')
  public itens?: ItemRecebimentoFisicoEntity[];
}
