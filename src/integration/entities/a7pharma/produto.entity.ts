import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { NumericColumn } from '../numeric-column.decorator';
import { EmbalagemEntity } from './embalagem.entity';
import { FabricanteEntity } from './fabricante.entity';
import { PrincipioAtivoEntity } from './principio-ativo.entity';

@Entity({ name: 'produto', schema: 'public', synchronize: false })
export class ProdutoEntity {
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

  @Column({ type: 'int', name: 'codigo', nullable: false })
  public codigo!: number;

  @Column({ type: 'varchar', length: 60, name: 'descricao', nullable: false })
  public descricao!: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'listapis',
    nullable: false,
    default: 'A',
  })
  public listapis!: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'tipopreco',
    nullable: false,
    default: 'L',
  })
  public tipopreco!: string;

  @Column({ type: 'varchar', length: 15, name: 'registroms', nullable: true })
  public registroms?: string;

  @Column({ type: 'bigint', name: 'nbmid', nullable: true })
  public nbmid?: number;

  @Column({ type: 'bigint', name: 'ncmid', nullable: true })
  public ncmid?: number;

  @Column({ type: 'bigint', name: 'produtoreferenciaid', nullable: true })
  public produtoreferenciaid?: number;

  @Column({ type: 'bigint', name: 'fabricanteid', nullable: false })
  public fabricanteid!: number;

  @Column({ type: 'bigint', name: 'tipoprodutoid', nullable: true })
  public tipoprodutoid?: number;

  @Column({ type: 'bigint', name: 'principioativoid', nullable: true })
  public principioativoid?: number;

  @Column({ type: 'bigint', name: 'dcbid', nullable: true })
  public dcbid?: number;

  @Column({
    type: 'char',
    length: 1,
    name: 'listadcb',
    nullable: false,
    default: '?',
  })
  public listadcb!: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'tipo',
    nullable: false,
    default: 'M',
  })
  public tipo!: string;

  @Column({
    type: 'varchar',
    length: 6,
    name: 'unidade',
    nullable: false,
    default: 'UN',
  })
  public unidade!: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'origemmercadoria',
    nullable: false,
    default: '0',
  })
  public origemmercadoria!: string;

  @Column({ type: 'bigint', name: 'perfilpisid', nullable: true })
  public perfilpisid?: number;

  @Column({ type: 'bigint', name: 'perfilcofinsid', nullable: true })
  public perfilcofinsid?: number;

  @Column({
    type: 'char',
    length: 1,
    name: 'unidademedidamedicamento',
    nullable: false,
    default: '1',
  })
  public unidademedidamedicamento!: string;

  @Column({
    type: 'boolean',
    name: 'medicamentoinconsistente',
    nullable: false,
    default: false,
  })
  public medicamentoinconsistente!: boolean;

  @Column({
    type: 'char',
    length: 1,
    name: 'origeminativacao',
    nullable: false,
    default: '?',
  })
  public origeminativacao!: string;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datahorainclusao',
    nullable: true,
  })
  public datahorainclusao?: Date;

  @Column({ type: 'bigint', name: 'usuarioinclusaoid', nullable: true })
  public usuarioinclusaoid?: number;

  @Column({
    type: 'char',
    length: 1,
    name: 'tributacaoproduto',
    nullable: false,
    default: 'M',
  })
  public tributacaoproduto!: string;

  @Column({ type: 'bigint', name: 'servicoissqnid', nullable: true })
  public servicoissqnid?: number;

  @Column({ type: 'bigint', name: 'perfilissqnid', nullable: true })
  public perfilissqnid?: number;

  @Column({ type: 'bigint', name: 'perfilpissnid', nullable: true })
  public perfilpissnid?: number;

  @Column({ type: 'bigint', name: 'perfilcofinssnid', nullable: true })
  public perfilcofinssnid?: number;

  @Column({ type: 'bigint', name: 'cestid', nullable: true })
  public cestid?: number;

  @Column({
    type: 'varchar',
    length: 2,
    name: 'tiposped',
    nullable: false,
    default: '00',
  })
  public tiposped!: string;

  @NumericColumn({
    precision: 15,
    scale: 4,
    name: 'medicamentoquantidadeapresentacao',
    nullable: true,
  })
  public medicamentoquantidadeapresentacao?: number;

  @Column({
    type: 'boolean',
    name: 'usocontinuo',
    nullable: false,
    default: false,
  })
  public usocontinuo!: boolean;

  @Column({ type: 'bigint', name: 'vacinaid', nullable: true })
  public vacinaid?: number;

  @Column({
    type: 'boolean',
    name: 'movimentacaofracionada',
    nullable: false,
    default: false,
  })
  public movimentacaofracionada!: boolean;

  @Column({
    type: 'varchar',
    length: 3,
    name: 'codigonaturezareceita',
    nullable: true,
  })
  public codigonaturezareceita?: string;

  @Column({
    type: 'boolean',
    name: 'permitirrevisaofiscalautomatica',
    nullable: false,
    default: true,
  })
  public permitirrevisaofiscalautomatica!: boolean;

  @Column({
    type: 'char',
    length: 1,
    name: 'tipomedicamento',
    nullable: false,
    default: '?',
  })
  public tipomedicamento!: string;

  @Column({
    type: 'boolean',
    name: 'isentoregistroms',
    nullable: false,
    default: false,
  })
  public isentoregistroms!: boolean;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'registromsmotivoisencao',
    nullable: true,
  })
  public registromsmotivoisencao?: string;

  @ManyToOne(() => FabricanteEntity, { nullable: false })
  @JoinColumn({ name: 'fabricanteid', referencedColumnName: 'id' })
  public fabricante!: FabricanteEntity;

  @ManyToOne(() => ProdutoEntity, { nullable: true })
  @JoinColumn({ name: 'produtoreferenciaid', referencedColumnName: 'id' })
  public produtoReferencia?: ProdutoEntity;

  @OneToMany(() => EmbalagemEntity, (embalagem) => embalagem.produto)
  public embalagens!: EmbalagemEntity[];

  @ManyToOne(() => PrincipioAtivoEntity, { nullable: true })
  @JoinColumn({ name: 'principioativoid', referencedColumnName: 'id' })
  public principioativo?: PrincipioAtivoEntity;
}
