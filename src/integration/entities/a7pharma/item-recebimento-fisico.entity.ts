import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { NumericColumn } from '../numeric-column.decorator';
import { EmbalagemEntity } from './embalagem.entity';
import { RecebimentoFisicoEntity } from './recebimento-fisico.entity';

@Entity({ name: 'itemrecebimentofisico', schema: 'public', synchronize: false })
@Index('idx_itemrecebimentofisico_embalagemid', ['embalagemid'])
@Index('idx_itemrecebimentofisico_movimentacaoestoqueid', [
  'movimentacaoestoqueid',
])
@Index('idx_itemrecebimentofisico_notafiscalid', ['notafiscalid'])
@Index('idx_itemrecebimentofisico_recebimentofisicoid_embalagemid', [
  'recebimentofisicoid',
  'embalagemid',
])
export class ItemRecebimentoFisicoEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({
    type: 'char',
    length: 1,
    name: 'status',
    nullable: false,
    default: 'A',
  })
  public status!: string;

  @Column({ type: 'bigint', name: 'recebimentofisicoid', nullable: false })
  public recebimentofisicoid!: number;

  @Column({ type: 'bigint', name: 'embalagemid', nullable: false })
  public embalagemid!: number;

  @Column({ type: 'bigint', name: 'movimentacaoestoqueid', nullable: true })
  public movimentacaoestoqueid?: number;

  @NumericColumn({
    precision: 15,
    scale: 4,
    nullable: false,
    name: 'quantidade',
  })
  public quantidade!: number;

  @Column({ type: 'bigint', name: 'notafiscalid', nullable: true })
  public notafiscalid?: number;

  @Column({ type: 'bigint', name: 'pedidocompraid', nullable: true })
  public pedidocompraid?: number;

  @Column({
    type: 'bigint',
    name: 'liberacaousuarioeditaritemid',
    nullable: true,
  })
  public liberacaousuarioeditaritemid?: number;

  @ManyToOne(() => EmbalagemEntity, { nullable: false })
  @JoinColumn({ name: 'embalagemid', referencedColumnName: 'id' })
  public embalagem!: EmbalagemEntity;

  @ManyToOne(() => RecebimentoFisicoEntity, (r) => r.itens, { nullable: false })
  @JoinColumn({ name: 'recebimentofisicoid', referencedColumnName: 'id' })
  public recebimentofisico!: RecebimentoFisicoEntity;
}
