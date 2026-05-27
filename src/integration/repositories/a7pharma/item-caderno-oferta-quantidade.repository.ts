import { Repository } from 'typeorm';
import { ItemCadernoOfertaQuantidadeEntity } from '../../entities/a7pharma/item-caderno-oferta-quantidade.entity';

/**
 * Quantity-tier offers for the given embalagem set, with the same
 * "truly active" filter applied to the parent caderno-oferta. Loads
 * the parent itemcadernooferta relation so the caller can group by
 * embalagemid.
 */
export class ItemCadernoOfertaQuantidadeRepository {
  constructor(
    private readonly repository: Repository<ItemCadernoOfertaQuantidadeEntity>,
  ) {}

  public findByEmbalagemIds(
    embalagemIds: number[],
  ): Promise<ItemCadernoOfertaQuantidadeEntity[]> {
    if (embalagemIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('icoq')
      .innerJoinAndSelect('icoq.itemcadernooferta', 'ico')
      .innerJoin('ico.cadernooferta', 'co')
      .where('ico.embalagemid IN (:...embalagemIds)', { embalagemIds })
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
      .getMany();
  }
}
