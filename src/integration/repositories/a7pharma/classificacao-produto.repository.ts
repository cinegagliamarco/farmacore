import { Repository } from 'typeorm';
import { ClassificacaoProdutoEntity } from '../../entities/a7pharma/classificacao-produto.entity';

export class ClassificacaoProdutoRepository {
  constructor(
    private readonly repository: Repository<ClassificacaoProdutoEntity>,
  ) {}

  /**
   * Principal classification per produto. Joins to `classificacao` and
   * filters `classificacao.principal = true`. Returns the entity with
   * its classificacao relation loaded.
   */
  public findPrincipalClassificationByProdutoIds(
    produtoIds: number[],
  ): Promise<ClassificacaoProdutoEntity[]> {
    if (produtoIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('cp')
      .innerJoinAndSelect('cp.classificacao', 'c')
      .where('cp.produtoid IN (:...produtoIds)', { produtoIds })
      .andWhere('c.principal = true')
      .getMany();
  }
}
