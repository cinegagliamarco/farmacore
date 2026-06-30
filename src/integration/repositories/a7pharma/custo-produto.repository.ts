import { Repository } from 'typeorm';
import { CustoProdutoEntity } from '../../entities/a7pharma/custo-produto.entity';

export class CustoProdutoRepository {
  constructor(private readonly repository: Repository<CustoProdutoEntity>) {}

  /**
   * Latest cost row per produtoid, selected by MAX(itemnotafiscalid).
   * Matches legacy CustoProdutoRepository.findLatestByProdutoIds.
   */
  public findLatestByProdutoIds(
    produtoIds: number[],
  ): Promise<CustoProdutoEntity[]> {
    if (produtoIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('cp')
      .where('cp.produtoid IN (:...produtoIds)', { produtoIds })
      .andWhere(
        `cp.itemnotafiscalid = (
          SELECT MAX(cp2.itemnotafiscalid)
          FROM custoproduto cp2
          WHERE cp2.produtoid = cp.produtoid
        )`,
      )
      .getMany();
  }

  /** Per-store cost rows for a slice of products in one store. The
   *  (produtoid, unidadenegocioid) unique index yields at most one row each. */
  public findByProdutoIdsAndUnidade(
    produtoIds: number[],
    unidadeNegocioId: number,
  ): Promise<CustoProdutoEntity[]> {
    if (produtoIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('cp')
      .where('cp.produtoid IN (:...produtoIds)', { produtoIds })
      .andWhere('cp.unidadenegocioid = :unidadeNegocioId', { unidadeNegocioId })
      .getMany();
  }
}
