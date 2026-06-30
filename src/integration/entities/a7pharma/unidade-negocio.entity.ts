import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A7Pharma business unit (store). Read-only source for store sync —
 * matched by CNPJ, filtered by status = 'A'. `id` is the store
 * `external_id` used for per-store reads/writes.
 */
@Entity({ name: 'unidadenegocio', schema: 'public', synchronize: false })
@Index('idx_unidadenegocio_cnpj', ['cnpj'])
export class UnidadeNegocioEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'char', length: 1, name: 'status', nullable: false })
  public status!: string;

  @Column({ type: 'varchar', name: 'codigo', nullable: true })
  public codigo?: string;

  @Column({ type: 'varchar', name: 'nome', nullable: true })
  public nome?: string;

  @Column({ type: 'varchar', name: 'nomefantasia', nullable: true })
  public nomefantasia?: string;

  @Column({ type: 'varchar', name: 'razaosocial', nullable: true })
  public razaosocial?: string;

  @Column({ type: 'varchar', name: 'cnpj', nullable: true })
  public cnpj?: string;
}
