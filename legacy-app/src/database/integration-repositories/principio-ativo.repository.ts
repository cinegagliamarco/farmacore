import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PrincipioAtivoTypeormEntity } from '../integration-entities/principio-ativo.entity';

@Injectable()
export class PrincipioAtivoRepository {
  constructor(private readonly repository: Repository<PrincipioAtivoTypeormEntity>) {}

  public async findAll(): Promise<PrincipioAtivoTypeormEntity[]> {
    return this.repository.find();
  }

  public async findPaginated(page: number, pageSize: number): Promise<[PrincipioAtivoTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip: page * pageSize,
      take: pageSize
    });
  }

  public async findById(id: number): Promise<PrincipioAtivoTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByIds(ids: number[]): Promise<PrincipioAtivoTypeormEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.repository.createQueryBuilder('co').where('co.id IN (:...ids)', { ids }).getMany();
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }
}
