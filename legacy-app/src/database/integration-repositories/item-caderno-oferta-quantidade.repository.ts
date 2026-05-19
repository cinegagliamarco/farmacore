import { Injectable } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { ItemCadernoOfertaQuantidadeTypeormEntity } from '../integration-entities/item-caderno-oferta-quantidade.entity';

@Injectable()
export class ItemCadernoOfertaQuantidadeRepository {
  constructor(private readonly repository: Repository<ItemCadernoOfertaQuantidadeTypeormEntity>) {}

  public async findByItemCadernoOfertaIds(itemCadernoOfertaIds: number[]): Promise<ItemCadernoOfertaQuantidadeTypeormEntity[]> {
    if (!itemCadernoOfertaIds.length) return [];

    return this.repository.find({
      where: { itemcadernoofertaid: In(itemCadernoOfertaIds) }
    });
  }

  /**
   * Finds all quantity-based offers for the given embalagem IDs.
   * Applies the same filters as findBestOffersByEmbalagemIds to ensure only valid offers are returned.
   * Returns quantities with their associated itemcadernooferta including embalagemid for grouping.
   */
  public async findByEmbalagemIds(embalagemIds: number[]): Promise<ItemCadernoOfertaQuantidadeTypeormEntity[]> {
    if (!embalagemIds.length) return [];

    return this.repository
      .createQueryBuilder('icoq')
      .innerJoinAndSelect('icoq.itemcadernooferta', 'ico')
      .innerJoin('ico.cadernooferta', 'co')
      .where('ico.embalagemid IN (:...embalagemIds)', { embalagemIds })
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
      .getMany();
  }
}
