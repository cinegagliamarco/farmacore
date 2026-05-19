import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ClassificacaoTypeormEntity } from './classificacao.entity';

@Entity('classificacaoproduto', { schema: 'public' })
@Index('idx_classificacaoproduto_classificacaoid', ['classificacaoid'])
@Index('idx_classificacaoproduto_produtoid', ['produtoid'])
@Index('uidx_classificacaoproduto_produtoid_classificacaoid', ['produtoid', 'classificacaoid'], { unique: true })
export class ClassificacaoProdutoTypeormEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id: number;

  @Column({ type: 'bigint', name: 'produtoid', nullable: false })
  public produtoid: number;

  @Column({ type: 'bigint', name: 'classificacaoid', nullable: false })
  public classificacaoid: number;

  @ManyToOne(() => ClassificacaoTypeormEntity, { nullable: false })
  @JoinColumn({ name: 'classificacaoid', referencedColumnName: 'id' })
  public classificacao: ClassificacaoTypeormEntity;
}

