import { Repository } from 'typeorm';
import { ItemCadernoOfertaEntity } from '../../entities/a7pharma/item-caderno-oferta.entity';

export type ItemCadernoOfertaWithPrice = ItemCadernoOfertaEntity & {
  effective_price?: number;
};

/**
 * Best active offer per embalagem, including a computed `effective_price`:
 *   - precooferta when set
 *   - else embalagem.precovenda * (1 - descontooferta/100)
 *   - else null (excluded by the WHERE clause)
 *
 * Filters down to truly active offers — status='A', non-promo flags off,
 * no day-of-week restriction, no expiration, payment form 'A'. Matches
 * the legacy filter set verbatim so behavior is preserved.
 */
export class ItemCadernoOfertaRepository {
  constructor(
    private readonly repository: Repository<ItemCadernoOfertaEntity>,
  ) {}

  public async findBestOffersWithDealsByEmbalagemIds(
    embalagemIds: number[],
  ): Promise<ItemCadernoOfertaWithPrice[]> {
    if (embalagemIds.length === 0) return [];

    const query = this.repository
      .createQueryBuilder('ico')
      .distinctOn(['ico.embalagemid'])
      .innerJoinAndSelect('ico.cadernooferta', 'co')
      .innerJoin('ico.embalagem', 'emb')
      .addSelect(
        `CASE
           WHEN ico.precooferta IS NOT NULL THEN ico.precooferta
           WHEN ico.descontooferta IS NOT NULL THEN emb.precovenda * (1 - ico.descontooferta / 100)
           ELSE NULL
         END`,
        'effective_price',
      )
      .where('ico.embalagemid IN (:...embalagemIds)', { embalagemIds })
      .andWhere('ico.comboofertaid IS NULL')
      .andWhere(
        `(
          (ico.precooferta IS NOT NULL AND ico.precooferta > 0)
          OR (ico.descontooferta IS NOT NULL AND ico.descontooferta > 0)
          OR EXISTS (SELECT 1 FROM itemcadernoofertaquantidade q WHERE q.itemcadernoofertaid = ico.id)
        )`,
      )
      .andWhere('co.status = :status', { status: 'A' })
      .andWhere('co.crmapenasgrupoconsumidor = false')
      .andWhere('co.validoapenascupomdesconto = false')
      .andWhere('co.validoapenasprevencido = false')
      .andWhere('co.formapagamentoaceita = :form', { form: 'A' })
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

    const { entities, raw } = await query.getRawAndEntities<{
      effective_price?: number | string | null;
    }>();
    return entities.map((entity, i) => {
      const ep = raw[i]?.effective_price;
      return {
        ...entity,
        effective_price: ep != null ? Number(ep) : undefined,
      };
    });
  }
}
