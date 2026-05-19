import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { EmbalagemTypeormEntity } from './embalagem.entity';
import { NumericColumn } from '../entities/numeric.decorator';

@Entity('estoque', { schema: 'public' })
@Index('cidx_estoque_embalagemid_unnegid_estoquenaozero', ['embalagemid', 'unidadenegocioid', 'estoque'])
@Index('idx_estoque_ultimamovimentacaoestoqueid', ['ultimamovimentacaoestoqueid'])
@Index('idx_estoque_unidadenegocioid', ['unidadenegocioid'])
@Index('uidx_estoque_embalagemid_unidadenegocioid', ['embalagemid', 'unidadenegocioid'], { unique: true })
export class EstoqueTypeormEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id: number;

  @Column({ type: 'bigint', name: 'unidadenegocioid', nullable: false })
  public unidadenegocioid: number;

  @Column({ type: 'bigint', name: 'embalagemid', nullable: false })
  public embalagemid: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'estoque', nullable: false, default: 0.0 })
  public estoque: number;

  @Column({ type: 'bigint', name: 'ultimamovimentacaoestoqueid', nullable: true })
  public ultimamovimentacaoestoqueid?: number;

  // Relationship with Embalagem
  @ManyToOne(() => EmbalagemTypeormEntity, { nullable: false })
  @JoinColumn({ name: 'embalagemid', referencedColumnName: 'id' })
  public embalagem: EmbalagemTypeormEntity;
}

