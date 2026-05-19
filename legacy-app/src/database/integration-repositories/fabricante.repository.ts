import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { FabricanteTypeormEntity } from '../integration-entities/fabricante.entity';

@Injectable()
export class FabricanteRepository {
  constructor(private readonly repository: Repository<FabricanteTypeormEntity>) {}

  public async findAll(): Promise<FabricanteTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<FabricanteTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByPessoaId(pessoaid: number): Promise<FabricanteTypeormEntity | null> {
    return this.repository.findOne({ where: { pessoaid } });
  }

  public async findWithPessoa(id: number): Promise<FabricanteTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['pessoa']
    });
  }

  public async findAllWithPessoa(): Promise<FabricanteTypeormEntity[]> {
    return this.repository.find({ relations: ['pessoa'] });
  }

  public async findWithPagination(skip: number, take: number): Promise<[FabricanteTypeormEntity[], number]> {
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

