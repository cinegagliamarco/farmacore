import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { PessoaEntity } from './pessoa.entity';

@Entity({ name: 'fabricante', schema: 'public', synchronize: false })
@Index('uidx_fabricante_pessoaid', ['pessoaid'], { unique: true })
export class FabricanteEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'bigint', name: 'pessoaid', nullable: false })
  public pessoaid!: number;

  @ManyToOne(() => PessoaEntity, { nullable: false })
  @JoinColumn({ name: 'pessoaid', referencedColumnName: 'id' })
  public pessoa!: PessoaEntity;
}
