import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CustoProdutoTypeormEntity } from '../integration-entities/custo-produto.entity';

@Injectable()
export class CustoProdutoRepository {
  constructor(private readonly repository: Repository<CustoProdutoTypeormEntity>) {}

  public async findAll(): Promise<CustoProdutoTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<CustoProdutoTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByProdutoId(produtoid: number): Promise<CustoProdutoTypeormEntity[]> {
    return this.repository.find({ where: { produtoid } });
  }

  public async findByUnidadeNegocioId(unidadenegocioid: number): Promise<CustoProdutoTypeormEntity[]> {
    return this.repository.find({ where: { unidadenegocioid } });
  }

  public async findByProdutoIdAndUnidadeNegocioId(produtoid: number, unidadenegocioid: number): Promise<CustoProdutoTypeormEntity | null> {
    return this.repository.findOne({ where: { produtoid, unidadenegocioid } });
  }

  public async findWithPagination(skip: number, take: number): Promise<[CustoProdutoTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip,
      take,
      order: { id: 'ASC' }
    });
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }

  public async findLatestByProdutoIds(produtoIds: number[]): Promise<CustoProdutoTypeormEntity[]> {
    if (produtoIds.length === 0) {
      return [];
    }
    // Get the latest record (by highest itemnotafiscalid) for each produtoid
    return this.repository
      .createQueryBuilder('cp')
      .where('cp.produtoid IN (:...produtoIds)', { produtoIds })
      .andWhere(
        `cp.itemnotafiscalid = (
          SELECT MAX(cp2.itemnotafiscalid) 
          FROM custoproduto cp2 
          WHERE cp2.produtoid = cp.produtoid
        )`
      )
      .getMany();
  }
}
