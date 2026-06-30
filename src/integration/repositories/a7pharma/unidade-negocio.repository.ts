import { Repository } from 'typeorm';
import { UnidadeNegocioEntity } from '../../entities/a7pharma/unidade-negocio.entity';

/**
 * Read-only repository over A7Pharma's `unidadenegocio` (stores). Plain
 * class, instantiated per pipeline-step invocation with the tenant's
 * integration DataSource.
 */
export class UnidadeNegocioRepository {
  constructor(private readonly repository: Repository<UnidadeNegocioEntity>) {}

  /** Active stores with a CNPJ — the only rows the store sync imports
   *  (matched/deduped by CNPJ). */
  public findAllActive(): Promise<UnidadeNegocioEntity[]> {
    return this.repository
      .createQueryBuilder('u')
      .where("u.status = 'A'")
      .andWhere('u.cnpj IS NOT NULL')
      .orderBy('u.id', 'ASC')
      .getMany();
  }
}
