import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CadernoOfertaTypeormEntity } from '../integration-entities/caderno-oferta.entity';

@Injectable()
export class CadernoOfertaRepository {
  constructor(private readonly repository: Repository<CadernoOfertaTypeormEntity>) {}

  public async findAll(): Promise<CadernoOfertaTypeormEntity[]> {
    return this.repository.find();
  }

  public async findPaginated(page: number, pageSize: number): Promise<[CadernoOfertaTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip: page * pageSize,
      take: pageSize
    });
  }

  public async findById(id: number): Promise<CadernoOfertaTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByIds(ids: number[]): Promise<CadernoOfertaTypeormEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.repository.createQueryBuilder('co').where('co.id IN (:...ids)', { ids }).getMany();
  }

  public async findActiveOffers(): Promise<CadernoOfertaTypeormEntity[]> {
    return this.repository.find({ where: { status: 'A' } });
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }
}
