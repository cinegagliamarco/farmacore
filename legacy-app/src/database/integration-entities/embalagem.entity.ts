import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { NumericColumn } from '../entities/numeric.decorator';
import { ProdutoTypeormEntity } from './produto.entity';

@Entity('embalagem', { schema: 'public' })
@Index('idx_embalagem_codigobarras', ['codigobarras'])
@Index('idx_embalagem_descricao', ['descricao'])
@Index('idx_embalagem_gruporemarcacaoid', ['gruporemarcacaoid'])
@Index('idx_embalagem_produtoid', ['produtoid'])
@Index('uidx_embalagem_etiqueta', ['etiqueta'], { unique: true })
export class EmbalagemTypeormEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id: number;

  @Column({ type: 'bigint', name: 'produtoid', nullable: false })
  public produtoid: number;

  @Column({ type: 'varchar', length: 39, name: 'apresentacao', nullable: true })
  public apresentacao?: string;

  @Column({ type: 'varchar', length: 14, name: 'codigobarras', nullable: true })
  public codigobarras?: string;

  @Column({ type: 'varchar', length: 6, name: 'etiqueta', nullable: false })
  public etiqueta: string;

  @Column({ type: 'int', name: 'quantidadeporembalagem', nullable: false })
  public quantidadeporembalagem: number;

  @Column({ type: 'boolean', name: 'padraofornecedores', nullable: false })
  public padraofornecedores: boolean;

  @Column({ type: 'bigint', name: 'embalagemcontidaid', nullable: true })
  public embalagemcontidaid?: number;

  @Column({ type: 'int', name: 'quantidadeembalagem', nullable: true })
  public quantidadeembalagem?: number;

  @NumericColumn({ precision: 15, scale: 4, nullable: false, name: 'precoreferencial'})
  public precoreferencial: number;

  @NumericColumn({ precision: 15, scale: 4, nullable: false, name: 'markup'})
  public markup: number;

  @NumericColumn({ precision: 15, scale: 4, nullable: false, name: 'precovenda'})
  public precovenda: number;

  @Column({ type: 'bigint', name: 'gruporemarcacaoid', nullable: true })
  public gruporemarcacaoid?: number;

  @Column({ type: 'varchar', length: 100, name: 'descricao', nullable: false })
  public descricao: string;

  @Column({ type: 'boolean', name: 'inclusaoautomaticapdv', nullable: false, default: false })
  public inclusaoautomaticapdv: boolean;

  @Column({ type: 'boolean', name: 'suspenderprocurabuscador', nullable: false, default: false })
  public suspenderprocurabuscador: boolean;

  @Column({ type: 'bigint', name: 'ultimaalteracaoprecoid', nullable: true })
  public ultimaalteracaoprecoid?: number;

  @Column({ type: 'boolean', name: 'precovendavariavel', nullable: false, default: false })
  public precovendavariavel: boolean;

  @NumericColumn({ precision: 15, scale: 4, name: 'margemlucrovenda', nullable: true })
  public margemlucrovenda?: number;

  @Column({ type: 'boolean', name: 'exigircodigoexterno', nullable: false, default: false })
  public exigircodigoexterno: boolean;

  @Column({ type: 'boolean', name: 'codigoexternounico', nullable: false, default: false })
  public codigoexternounico: boolean;

  @Column({ type: 'timestamp', precision: 0, name: 'datahorainclusao', nullable: true })
  public datahorainclusao?: Date;

  @Column({ type: 'timestamp', precision: 0, name: 'datahoraedicaocodigobarras', nullable: true })
  public datahoraedicaocodigobarras?: Date;

  @Column({ type: 'bigint', name: 'usuarioinclusaoid', nullable: true })
  public usuarioinclusaoid?: number;

  @NumericColumn({ precision: 15, scale: 4, nullable: true, name: 'largura'})
  public largura?: number;

  @NumericColumn({ precision: 15, scale: 4, nullable: true, name: 'altura'})
  public altura?: number;

  @NumericColumn({ precision: 15, scale: 4, nullable: true, name: 'comprimento'})
  public comprimento?: number;

  @NumericColumn({ precision: 15, scale: 4, nullable: true, name: 'peso'})
  public peso?: number;

  @Column({ type: 'boolean', name: 'padraointegracoes', nullable: false, default: false })
  public padraointegracoes: boolean;

  @NumericColumn({ precision: 15, scale: 4, name: 'quantidadecomercial', nullable: true })
  public quantidadecomercial?: number;

  @Column({ type: 'char', length: 1, name: 'unidademedidacomercial', nullable: false, default: '?' })
  public unidademedidacomercial: string;

  // Self-referencing relationship for embalagemcontidaid
  @ManyToOne(() => EmbalagemTypeormEntity, { nullable: true })
  @JoinColumn({ name: 'embalagemcontidaid', referencedColumnName: 'id' })
  public embalagemcontida?: EmbalagemTypeormEntity;

  // Relationship with Produto
  @ManyToOne(() => ProdutoTypeormEntity, (produto) => produto.embalagens, { nullable: false })
  @JoinColumn({ name: 'produtoid', referencedColumnName: 'id' })
  public produto: ProdutoTypeormEntity;
}

