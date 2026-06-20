import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantOfferCampaignEntity } from '../../database/entities/tenant/tenant-offer-campaign.entity';

export interface OfferCampaign {
  id: number;
  name: string;
}

@Injectable()
export class OfferCampaignsService {
  /**
   * Cadernos de oferta ativos e vigentes do tenant (id + nome) para o
   * seletor de ofertas. `id` é o `external_id` (idCadernoOferta da
   * A7Pharma) — o mesmo valor que volta como `cadernoId` em
   * POST /products/:ean/offer. Os cadernos são do tenant inteiro: o ERP
   * não os separa por loja. Inativos e já vencidos ficam de fora — a sync
   * nunca remove cadernos apagados no ERP, então filtrar aqui evita
   * oferecer caderno morto.
   */
  public async list(em: EntityManager): Promise<OfferCampaign[]> {
    const rows = await em
      .getRepository(TenantOfferCampaignEntity)
      .createQueryBuilder('c')
      .select(['c.externalId', 'c.name'])
      .where('c.active = true')
      .andWhere('c.deletedAt IS NULL')
      .andWhere('(c.startDate IS NULL OR c.startDate <= :now)')
      .andWhere('(c.expirationDate IS NULL OR c.expirationDate >= :now)', {
        now: new Date(),
      })
      .orderBy('c.name', 'ASC')
      .addOrderBy('c.externalId', 'ASC')
      .getMany();
    return rows.map((r) => ({ id: Number(r.externalId), name: r.name }));
  }
}
