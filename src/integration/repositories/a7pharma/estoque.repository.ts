import { Repository } from 'typeorm';
import { EstoqueEntity } from '../../entities/a7pharma/estoque.entity';

/**
 * Read-only repository over A7Pharma's `estoque` table. The schema is
 * keyed on (embalagemid, unidadenegocioid) — one row per (packaging,
 * store) with the current quantity. Multiple estoque rows can share
 * an embalagemid (different stores).
 */
export class EstoqueRepository {
  constructor(private readonly repository: Repository<EstoqueEntity>) {}

  /**
   * All stock rows for the given embalagem IDs, across every store.
   * Pre-filtered to estoque > 0 so the caller's grouping/upsert sees
   * only positive quantities (legacy import skipped zeros anyway).
   */
  public findByEmbalagemIds(
    embalagemIds: number[],
  ): Promise<EstoqueEntity[]> {
    if (embalagemIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('e')
      .where('e.embalagemid IN (:...embalagemIds)', { embalagemIds })
      .andWhere('e.estoque > 0')
      .getMany();
  }
}
