import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ProdutoTypeormEntity } from '../integration-entities/produto.entity';

@Injectable()
export class ProdutoRepository {
  constructor(private readonly repository: Repository<ProdutoTypeormEntity>) {}

  public async findAll(): Promise<ProdutoTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<ProdutoTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByIdWithRelations(id: number): Promise<ProdutoTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['fabricante', 'fabricante.pessoa', 'embalagens']
    });
  }

  public async findWithPagination(skip: number, take: number): Promise<[ProdutoTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip,
      take,
      order: { id: 'ASC' }
    });
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }
}

