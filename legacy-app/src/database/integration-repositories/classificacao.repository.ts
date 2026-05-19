import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ClassificacaoTypeormEntity } from '../integration-entities/classificacao.entity';

@Injectable()
export class ClassificacaoRepository {
  constructor(private readonly repository: Repository<ClassificacaoTypeormEntity>) {}

  public async findAll(): Promise<ClassificacaoTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<ClassificacaoTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByNome(nome: string): Promise<ClassificacaoTypeormEntity | null> {
    return this.repository.findOne({ where: { nome } });
  }

  public async findRoots(): Promise<ClassificacaoTypeormEntity[]> {
    return this.repository.find({ where: { classificacaopaiid: undefined } });
  }

  public async findByParentId(classificacaopaiid: number): Promise<ClassificacaoTypeormEntity[]> {
    return this.repository.find({ where: { classificacaopaiid } });
  }

  public async findLeaves(): Promise<ClassificacaoTypeormEntity[]> {
    return this.repository.find({ where: { folha: true } });
  }

  public async findPrincipais(): Promise<ClassificacaoTypeormEntity[]> {
    return this.repository.find({ where: { principal: true } });
  }

  public async findWithPagination(skip: number, take: number): Promise<[ClassificacaoTypeormEntity[], number]> {
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

