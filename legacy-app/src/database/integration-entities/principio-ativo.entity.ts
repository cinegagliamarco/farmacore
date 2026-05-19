import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('principioativo', { schema: 'public' })
export class PrincipioAtivoTypeormEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id: number;

  @Column({ type: 'varchar', length: 255, name: 'nome', nullable: false })
  public nome: string;
}
