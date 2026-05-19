import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PessoaTypeormEntity } from '../integration-entities/pessoa.entity';

@Injectable()
export class PessoaRepository {
  constructor(private readonly repository: Repository<PessoaTypeormEntity>) {}

  public async findAll(): Promise<PessoaTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<PessoaTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByNome(nome: string): Promise<PessoaTypeormEntity[]> {
    return this.repository.find({ where: { nome } });
  }

  public async findByCpf(cpf: string): Promise<PessoaTypeormEntity | null> {
    return this.repository.findOne({ where: { cpf } });
  }

  public async findByCnpj(cnpj: string): Promise<PessoaTypeormEntity | null> {
    return this.repository.findOne({ where: { cnpj } });
  }

  public async findByTipo(tipo: string): Promise<PessoaTypeormEntity[]> {
    return this.repository.find({ where: { tipo } });
  }

  public async findByStatus(status: string): Promise<PessoaTypeormEntity[]> {
    return this.repository.find({ where: { status } });
  }

  public async findWithPagination(skip: number, take: number): Promise<[PessoaTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip,
      take,
      order: { id: 'ASC' }
    });
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }

  public async searchByNome(nome: string): Promise<PessoaTypeormEntity[]> {
    return this.repository
      .createQueryBuilder('pessoa')
      .where('pessoa.nome ILIKE :nome', { nome: `%${nome}%` })
      .getMany();
  }
}

