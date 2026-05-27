import { Repository } from 'typeorm';
import { CadernoOfertaEntity } from '../../entities/a7pharma/caderno-oferta.entity';

/**
 * Read-only repository over A7Pharma's `caderno_oferta` (promotional
 * campaign header). Volume is small (~100 rows/tenant), so no pagination.
 */
export class CadernoOfertaRepository {
  constructor(private readonly repository: Repository<CadernoOfertaEntity>) {}

  public findAll(): Promise<CadernoOfertaEntity[]> {
    return this.repository
      .createQueryBuilder('co')
      .orderBy('co.id', 'ASC')
      .getMany();
  }
}
