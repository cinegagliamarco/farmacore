import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { NumericColumn } from '../entities/numeric.decorator';
import { CadernoOfertaTypeormEntity } from './caderno-oferta.entity';
import { ClassificacaoTypeormEntity } from './classificacao.entity';
import { EmbalagemTypeormEntity } from './embalagem.entity';
import { FabricanteTypeormEntity } from './fabricante.entity';
import { ItemCadernoOfertaQuantidadeTypeormEntity } from './item-caderno-oferta-quantidade.entity';

@Entity('itemcadernooferta', { schema: 'public' })
@Index('idx_itemcadernooferta_cadernoofertaid', ['cadernoofertaid'])
export class ItemCadernoOfertaTypeormEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id: number;

  @Column({ type: 'bigint', name: 'embalagemid', nullable: true })
  public embalagemid?: number;

  @Column({ type: 'bigint', name: 'cadernoofertaid', nullable: false })
  public cadernoofertaid: number;

  @Column({ type: 'char', length: 1, name: 'tipooferta', nullable: false, default: 'P' })
  public tipooferta: string;

  @NumericColumn({ precision: 15, scale: 4, name: 'precooferta', nullable: true })
  public precooferta?: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'descontooferta', nullable: true })
  public descontooferta?: number;

  @Column({ type: 'int', name: 'leve', nullable: true })
  public leve?: number;

  @Column({ type: 'int', name: 'pague', nullable: true })
  public pague?: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'descontolevepague', nullable: true })
  public descontolevepague?: number;

  @Column({ type: 'char', length: 1, name: 'tipoitem', nullable: false, default: 'A' })
  public tipoitem: string;

  @Column({ type: 'bigint', name: 'gruporemarcacaoid', nullable: true })
  public gruporemarcacaoid?: number;

  @Column({ type: 'bigint', name: 'fabricanteid', nullable: true })
  public fabricanteid?: number;

  @Column({ type: 'bigint', name: 'classificacaoid', nullable: true })
  public classificacaoid?: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'markup', nullable: true })
  public markup?: number;

  @Column({ type: 'char', length: 1, name: 'descontoporqtdtipo', nullable: false, default: 'A' })
  public descontoporqtdtipo: string;

  @Column({ type: 'char', length: 1, name: 'descontoporqtdvendaacimaqtd', nullable: false, default: 'A' })
  public descontoporqtdvendaacimaqtd: string;

  @Column({ type: 'bigint', name: 'comboofertaid', nullable: true })
  public comboofertaid?: number;

  @Column({ type: 'int', name: 'comboquantidadevenda', nullable: true })
  public comboquantidadevenda?: number;

  @Column({ type: 'bigint', name: 'cadernoofertafaixaparcelamentoid', nullable: true })
  public cadernoofertafaixaparcelamentoid?: number;

  @Column({ type: 'timestamp', precision: 0, name: 'ultimaedicaodatahora', nullable: true })
  public ultimaedicaodatahora?: Date;

  @Column({ type: 'bigint', name: 'ultimaedicaousuarioid', nullable: true })
  public ultimaedicaousuarioid?: number;

  @Column({ type: 'int', name: 'quantidadeutilizacaoofertavenda', nullable: false, default: 0 })
  public quantidadeutilizacaoofertavenda: number;

  @Column({ type: 'bigint', name: 'grupoembalagemid', nullable: true })
  public grupoembalagemid?: number;

  @Column({ type: 'bigint', name: 'idscanntech', nullable: true })
  public idscanntech?: number;

  @Column({ type: 'varchar', length: 255, name: 'tituloscanntech', nullable: true })
  public tituloscanntech?: string;

  // Relationships
  @ManyToOne(() => EmbalagemTypeormEntity, { nullable: true })
  @JoinColumn({ name: 'embalagemid', referencedColumnName: 'id' })
  public embalagem?: EmbalagemTypeormEntity;

  @ManyToOne(() => FabricanteTypeormEntity, { nullable: true })
  @JoinColumn({ name: 'fabricanteid', referencedColumnName: 'id' })
  public fabricante?: FabricanteTypeormEntity;

  @ManyToOne(() => ClassificacaoTypeormEntity, { nullable: true })
  @JoinColumn({ name: 'classificacaoid', referencedColumnName: 'id' })
  public classificacao?: ClassificacaoTypeormEntity;

  @ManyToOne(() => CadernoOfertaTypeormEntity, { nullable: false })
  @JoinColumn({ name: 'cadernoofertaid', referencedColumnName: 'id' })
  public cadernooferta?: CadernoOfertaTypeormEntity;

  @OneToMany(() => ItemCadernoOfertaQuantidadeTypeormEntity, (q) => q.itemcadernooferta)
  public quantidades?: ItemCadernoOfertaQuantidadeTypeormEntity[];
}

