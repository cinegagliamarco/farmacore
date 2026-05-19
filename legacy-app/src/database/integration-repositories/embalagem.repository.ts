import { Injectable } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { EmbalagemTypeormEntity } from '../integration-entities/embalagem.entity';

@Injectable()
export class EmbalagemRepository {
  constructor(private readonly repository: Repository<EmbalagemTypeormEntity>) {}

  public async findById(id: number): Promise<EmbalagemTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByEtiqueta(etiqueta: string): Promise<EmbalagemTypeormEntity | null> {
    return this.repository.findOne({ where: { etiqueta } });
  }

  public async findByCodigoBarras(codigobarras: string): Promise<EmbalagemTypeormEntity | null> {
    return this.repository.findOne({ where: { codigobarras } });
  }

  public async findAllValid(): Promise<EmbalagemTypeormEntity[]> {
    return this.createValidEmbalagemQuery().getMany();
  }

  public async findAllValidWithPagination(skip: number, take: number): Promise<EmbalagemTypeormEntity[]> {
    return this.createValidEmbalagemQuery().orderBy('e.id', 'ASC').skip(skip).take(take).getMany();
  }

  public async findAllValidWithPaginationAndRelations(skip: number, take: number): Promise<EmbalagemTypeormEntity[]> {
    return this.createValidEmbalagemQuery()
      .leftJoinAndSelect('e.produto', 'produto')
      .leftJoinAndSelect('produto.fabricante', 'fabricante')
      .leftJoinAndSelect('produto.principioativo', 'principioativo')
      .leftJoinAndSelect('fabricante.pessoa', 'pessoa')
      .orderBy('e.id', 'ASC')
      .skip(skip)
      .take(take)
      .getMany();
  }

  public async countValid(): Promise<number> {
    return this.createValidEmbalagemQuery().getCount();
  }

  public async findByProdutoId(produtoid: number): Promise<EmbalagemTypeormEntity[]> {
    return this.repository.find({ where: { produtoid } });
  }

  public async findByIds(ids: number[]): Promise<EmbalagemTypeormEntity[]> {
    if (ids.length === 0) return [];
    return this.repository.createQueryBuilder('e').where('e.id IN (:...ids)', { ids }).getMany();
  }

  public async findByCodigoBarrasWithSupplier(codigobarras: string): Promise<EmbalagemTypeormEntity | null> {
    return this.repository.findOne({
      where: { codigobarras },
      relations: ['produto', 'produto.fabricante', 'produto.fabricante.pessoa']
    });
  }

  public async findByCodigoBarrasList(codigobarrasList: string[]): Promise<EmbalagemTypeormEntity[]> {
    if (codigobarrasList.length === 0) return [];
    return this.repository
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.produto', 'produto')
      .leftJoinAndSelect('produto.fabricante', 'fabricante')
      .leftJoinAndSelect('fabricante.pessoa', 'pessoa')
      .where('e.codigobarras IN (:...codigobarrasList)', { codigobarrasList })
      .getMany();
  }

  private createValidEmbalagemQuery(): SelectQueryBuilder<EmbalagemTypeormEntity> {
    return this.repository
      .createQueryBuilder('e')
      .where('e.codigobarras IS NOT NULL')
      .andWhere('e.codigobarras != :empty', { empty: '' })
      .andWhere('e.quantidadeporembalagem = :quantity', { quantity: 1 });
  }
}
