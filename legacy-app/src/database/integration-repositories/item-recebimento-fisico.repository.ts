import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ItemRecebimentoFisicoTypeormEntity } from '../integration-entities/item-recebimento-fisico.entity';

export interface LatestReceiptDate {
  embalagemid: number;
  datahora: Date;
}

@Injectable()
export class ItemRecebimentoFisicoRepository {
  constructor(private readonly repository: Repository<ItemRecebimentoFisicoTypeormEntity>) {}

  public async findLatestReceiptDateByEmbalagemIds(embalagemIds: number[]): Promise<LatestReceiptDate[]> {
    if (!embalagemIds.length) return [];

    // Get the latest receipt date (datahora from recebimentofisico) for each embalagemid
    const result = await this.repository
      .createQueryBuilder('item')
      .innerJoin('item.recebimentofisico', 'recebimento')
      .select('item.embalagemid', 'embalagemid')
      .addSelect('MAX(recebimento.datahora)', 'datahora')
      .where('item.embalagemid IN (:...embalagemIds)', { embalagemIds })
      .groupBy('item.embalagemid')
      .getRawMany<LatestReceiptDate>();

    return result;
  }
}

