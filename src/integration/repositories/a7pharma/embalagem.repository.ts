import { Repository, SelectQueryBuilder } from 'typeorm';
import { EmbalagemEntity } from '../../entities/a7pharma/embalagem.entity';

/**
 * Read-only repository over A7Pharma's `embalagem` table.
 *
 * Plain class (not @Injectable) — instantiated per pipeline-step
 * invocation with the tenant-scoped integration DataSource.
 *
 * "Valid" means: codigobarras present + non-empty + quantidadeporembalagem = 1.
 * Matches legacy `EmbalagemRepository.createValidEmbalagemQuery`.
 */
export class EmbalagemRepository {
  constructor(private readonly repository: Repository<EmbalagemEntity>) {}

  public countValid(): Promise<number> {
    return this.validQuery().getCount();
  }

  /**
   * Lightweight (id, codigobarras) pairs for the dispatcher's EAN
   * chunker. Two embalagens can share a barcode; only the dispatcher
   * has the full picture needed to keep them in the same batch.
   */
  public async findAllValidWithBarcode(): Promise<
    Array<{ id: number; codigobarras: string }>
  > {
    const rows = await this.validQuery()
      .select(['e.id AS id', 'e.codigobarras AS codigobarras'])
      .orderBy('e.id', 'ASC')
      .getRawMany<{ id: string; codigobarras: string }>();
    return rows.map((r) => ({
      id: Number(r.id),
      codigobarras: r.codigobarras,
    }));
  }

  /**
   * Full embalagem rows for a given ID slice WITH the relations the
   * sync-base-product step needs (produto + fabricante + pessoa).
   * Bounded to the batch size so the heap footprint is one batch worth
   * of rows, not the whole table.
   */
  public findByIdsWithRelations(ids: number[]): Promise<EmbalagemEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.validQuery()
      .leftJoinAndSelect('e.produto', 'produto')
      .leftJoinAndSelect('produto.fabricante', 'fabricante')
      .leftJoinAndSelect('fabricante.pessoa', 'pessoa')
      .andWhere('e.id IN (:...ids)', { ids })
      .orderBy('e.id', 'ASC')
      .getMany();
  }

  /** Lean (embalagemid → produtoid) pairs for a slice, used by the
   *  product-item sync to look up per-store cost (keyed by produtoid). */
  public async findProdutoIdsByIds(
    ids: number[],
  ): Promise<Array<{ id: number; produtoid: number }>> {
    if (ids.length === 0) return [];
    const rows = await this.repository
      .createQueryBuilder('e')
      .select(['e.id AS id', 'e.produtoid AS produtoid'])
      .where('e.id IN (:...ids)', { ids })
      .getRawMany<{ id: string; produtoid: string }>();
    return rows.map((r) => ({
      id: Number(r.id),
      produtoid: Number(r.produtoid),
    }));
  }

  private validQuery(): SelectQueryBuilder<EmbalagemEntity> {
    return this.repository
      .createQueryBuilder('e')
      .where('e.codigobarras IS NOT NULL')
      .andWhere("e.codigobarras <> ''")
      .andWhere('e.quantidadeporembalagem = :one', { one: 1 });
  }
}
