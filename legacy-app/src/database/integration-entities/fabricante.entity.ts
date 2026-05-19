import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PessoaTypeormEntity } from './pessoa.entity';

@Entity('fabricante', { schema: 'public' })
@Index('uidx_fabricante_pessoaid', ['pessoaid'], { unique: true })
export class FabricanteTypeormEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id: number;

  @Column({ type: 'bigint', name: 'pessoaid', nullable: false })
  public pessoaid: number;

  @ManyToOne(() => PessoaTypeormEntity, { nullable: false })
  @JoinColumn({ name: 'pessoaid', referencedColumnName: 'id' })
  public pessoa: PessoaTypeormEntity;
}

