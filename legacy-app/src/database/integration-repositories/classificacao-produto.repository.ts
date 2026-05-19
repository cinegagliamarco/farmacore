import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ClassificacaoProdutoTypeormEntity } from '../integration-entities/classificacao-produto.entity';

@Injectable()
export class ClassificacaoProdutoRepository {
  constructor(private readonly repository: Repository<ClassificacaoProdutoTypeormEntity>) {}

  public async findAll(): Promise<ClassificacaoProdutoTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<ClassificacaoProdutoTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByProdutoId(produtoid: number): Promise<ClassificacaoProdutoTypeormEntity[]> {
    return this.repository.find({ where: { produtoid } });
  }

  public async findByClassificacaoId(classificacaoid: number): Promise<ClassificacaoProdutoTypeormEntity[]> {
    return this.repository.find({ where: { classificacaoid } });
  }

  public async findByProdutoIdWithClassificacao(produtoid: number): Promise<ClassificacaoProdutoTypeormEntity[]> {
    return this.repository.find({
      where: { produtoid },
      relations: ['classificacao']
    });
  }

  public async findWithPagination(skip: number, take: number): Promise<[ClassificacaoProdutoTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip,
      take,
      order: { id: 'ASC' }
    });
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }

  public async findPrincipalClassificationByProdutoIds(produtoIds: number[]): Promise<ClassificacaoProdutoTypeormEntity[]> {
    if (produtoIds.length === 0) {
      return [];
    }
    return this.repository
      .createQueryBuilder('cp')
      .innerJoinAndSelect('cp.classificacao', 'c')
      .where('cp.produtoid IN (:...produtoIds)', { produtoIds })
      .andWhere('c.principal = true')
      .getMany();
  }
}

