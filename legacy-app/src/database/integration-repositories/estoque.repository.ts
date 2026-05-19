import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { EstoqueTypeormEntity } from '../integration-entities/estoque.entity';

@Injectable()
export class EstoqueRepository {
  constructor(private readonly repository: Repository<EstoqueTypeormEntity>) {}

  public async findAll(): Promise<EstoqueTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<EstoqueTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByEmbalagemId(embalagemid: number): Promise<EstoqueTypeormEntity[]> {
    return this.repository.find({ where: { embalagemid } });
  }

  public async findByUnidadeNegocioId(unidadenegocioid: number): Promise<EstoqueTypeormEntity[]> {
    return this.repository.find({ where: { unidadenegocioid } });
  }

  public async findAllWithStock(): Promise<EstoqueTypeormEntity[]> {
    return this.repository.createQueryBuilder('e').where('e.estoque > 0').getMany();
  }

  public async findAllWithStockAndPagination(skip: number, take: number): Promise<EstoqueTypeormEntity[]> {
    return this.repository.createQueryBuilder('e').where('e.estoque > 0').orderBy('e.id', 'ASC').skip(skip).take(take).getMany();
  }

  public async findByEmbalagemIdAndUnidadeNegocioId(embalagemid: number, unidadenegocioid: number): Promise<EstoqueTypeormEntity | null> {
    return this.repository.findOne({
      where: { embalagemid, unidadenegocioid }
    });
  }

  public async getTotalStockByEmbalagemId(embalagemid: number): Promise<number> {
    const result = await this.repository
      .createQueryBuilder('e')
      .select('SUM(e.estoque)', 'total')
      .where('e.embalagemid = :embalagemid', { embalagemid })
      .getRawOne();

    return result?.total ? Number(result.total) : 0;
  }

  public async getStockAggregationByEmbalagem(): Promise<Map<number, number>> {
    const results = await this.repository
      .createQueryBuilder('e')
      .select('e.embalagemid', 'embalagemid')
      .addSelect('SUM(e.estoque)', 'total')
      .where('e.estoque > 0')
      .groupBy('e.embalagemid')
      .getRawMany();

    const stockMap = new Map<number, number>();
    results.forEach((result: { embalagemid: number; total: string }) => {
      stockMap.set(result.embalagemid, Number(result.total));
    });

    return stockMap;
  }

  public async findWithPagination(skip: number, take: number): Promise<[EstoqueTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip,
      take,
      order: { id: 'ASC' }
    });
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }

  public async countWithStock(): Promise<number> {
    return this.repository.createQueryBuilder('e').where('e.estoque > 0').getCount();
  }

  public async findByEmbalagemIds(embalagemids: number[]): Promise<EstoqueTypeormEntity[]> {
    if (embalagemids.length === 0) {
      return [];
    }
    return this.repository.createQueryBuilder('e').where('e.embalagemid IN (:...embalagemids)', { embalagemids }).getMany();
  }
}
