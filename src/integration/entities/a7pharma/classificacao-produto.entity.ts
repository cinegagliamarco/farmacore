import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ClassificacaoEntity } from './classificacao.entity';

@Entity({ name: 'classificacaoproduto', schema: 'public', synchronize: false })
@Index('idx_classificacaoproduto_classificacaoid', ['classificacaoid'])
@Index('idx_classificacaoproduto_produtoid', ['produtoid'])
@Index(
  'uidx_classificacaoproduto_produtoid_classificacaoid',
  ['produtoid', 'classificacaoid'],
  { unique: true },
)
export class ClassificacaoProdutoEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'bigint', name: 'produtoid', nullable: false })
  public produtoid!: number;

  @Column({ type: 'bigint', name: 'classificacaoid', nullable: false })
  public classificacaoid!: number;

  @ManyToOne(() => ClassificacaoEntity, { nullable: false })
  @JoinColumn({ name: 'classificacaoid', referencedColumnName: 'id' })
  public classificacao!: ClassificacaoEntity;
}
