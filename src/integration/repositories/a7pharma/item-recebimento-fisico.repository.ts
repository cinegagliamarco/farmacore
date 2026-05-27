import { Repository } from 'typeorm';
import { ItemRecebimentoFisicoEntity } from '../../entities/a7pharma/item-recebimento-fisico.entity';

export interface LatestReceiptDate {
  embalagemid: number;
  datahora: Date;
}

export class ItemRecebimentoFisicoRepository {
  constructor(
    private readonly repository: Repository<ItemRecebimentoFisicoEntity>,
  ) {}

  /**
   * Latest physical receipt date per embalagem, via MAX(recebimentofisico.datahora).
   */
  public findLatestReceiptDateByEmbalagemIds(
    embalagemIds: number[],
  ): Promise<LatestReceiptDate[]> {
    if (embalagemIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('item')
      .innerJoin('item.recebimentofisico', 'recebimento')
      .select('item.embalagemid', 'embalagemid')
      .addSelect('MAX(recebimento.datahora)', 'datahora')
      .where('item.embalagemid IN (:...embalagemIds)', { embalagemIds })
      .groupBy('item.embalagemid')
      .getRawMany<LatestReceiptDate>();
  }
}
