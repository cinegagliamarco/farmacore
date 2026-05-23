import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'principioativo', schema: 'public', synchronize: false })
export class PrincipioAtivoEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'varchar', length: 255, name: 'nome', nullable: false })
  public nome!: string;
}
