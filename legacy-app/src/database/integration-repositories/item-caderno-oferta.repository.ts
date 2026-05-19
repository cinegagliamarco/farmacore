import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ItemCadernoOfertaTypeormEntity } from '../integration-entities/item-caderno-oferta.entity';

@Injectable()
export class ItemCadernoOfertaRepository {
  constructor(private readonly repository: Repository<ItemCadernoOfertaTypeormEntity>) {}

  public async findAll(): Promise<ItemCadernoOfertaTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<ItemCadernoOfertaTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByCadernoOfertaId(cadernoofertaid: number): Promise<ItemCadernoOfertaTypeormEntity[]> {
    return this.repository.find({ where: { cadernoofertaid } });
  }

  public async findByEmbalagemId(embalagemid: number): Promise<ItemCadernoOfertaTypeormEntity[]> {
    return this.repository.find({ where: { embalagemid } });
  }

  public async findByFabricanteId(fabricanteid: number): Promise<ItemCadernoOfertaTypeormEntity[]> {
    return this.repository.find({ where: { fabricanteid } });
  }

  public async findByClassificacaoId(classificacaoid: number): Promise<ItemCadernoOfertaTypeormEntity[]> {
    return this.repository.find({ where: { classificacaoid } });
  }

  public async findWithRelations(id: number): Promise<ItemCadernoOfertaTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['embalagem', 'fabricante', 'classificacao']
    });
  }

  public async findWithPagination(skip: number, take: number): Promise<[ItemCadernoOfertaTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip,
      take,
      order: { id: 'ASC' }
    });
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }

  /**
   * Finds the best offer for each embalagem, including quantity-based deals.
   * Returns one item per embalagemid with the lowest effective price.
   * Effective price is calculated as:
   * - precooferta if it exists
   * - embalagem.precovenda * (1 - descontooferta/100) if only descontooferta exists (percentage discount)
   * Includes cadernooferta relationships.
   */
  public async findBestOffersWithDealsByEmbalagemIds(
    embalagemIds: number[]
  ): Promise<(ItemCadernoOfertaTypeormEntity & { effective_price?: number })[]> {
    if (!embalagemIds.length) return [];

    const query = this.repository
      .createQueryBuilder('ico')
      .distinctOn(['ico.embalagemid'])
      .innerJoinAndSelect('ico.cadernooferta', 'co')
      .innerJoin('ico.embalagem', 'emb')
      .addSelect(
        'CASE WHEN ico.precooferta IS NOT NULL THEN ico.precooferta WHEN ico.descontooferta IS NOT NULL THEN emb.precovenda * (1 - ico.descontooferta / 100) ELSE NULL END',
        'effective_price'
      )
      .where('ico.embalagemid IN (:...embalagemIds)', { embalagemIds })
      .andWhere('ico.comboofertaid IS NULL')
      .andWhere(
        '(ico.precooferta IS NOT NULL AND ico.precooferta > 0 OR ico.descontooferta IS NOT NULL AND ico.descontooferta > 0 OR EXISTS (SELECT 1 FROM itemcadernoofertaquantidade q WHERE q.itemcadernoofertaid = ico.id))'
      )
      .andWhere('co.status = :status', { status: 'A' })
      .andWhere('co.crmapenasgrupoconsumidor = false')
      .andWhere('co.validoapenascupomdesconto = false')
      .andWhere('co.validoapenasprevencido = false')
      .andWhere('co.formapagamentoaceita = :formapagamentoaceita', { formapagamentoaceita: 'A' })
      .andWhere('co.diasemanasegunda = false')
      .andWhere('co.diasemanaterca = false')
      .andWhere('co.diasemanaquarta = false')
      .andWhere('co.diasemanaquinta = false')
      .andWhere('co.diasemanasexta = false')
      .andWhere('co.diasemanasabado = false')
      .andWhere('co.diasemanadomingo = false')
      .andWhere('(co.datahorafinal >= NOW() OR co.datahorafinal IS NULL)')
      .orderBy('ico.embalagemid', 'ASC')
      .addOrderBy('effective_price', 'ASC', 'NULLS LAST');

    const { entities, raw } = await query.getRawAndEntities();

    return entities.map((entity, index) => ({
      ...entity,
      effective_price: raw[index]?.effective_price ? Number(raw[index].effective_price) : undefined
    }));
  }
}
