import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CatalogMutationService } from '../../tenant-api/catalog/catalog-mutation.service';

interface ItemRow {
  id: string;
  ean: string;
  target: 'precoVenda' | 'precoOferta';
  price: string;
  cadernoId: string | null;
}

type Permanent = { status: 'skipped' | 'failed'; reason: string };

/**
 * Aplica os itens de um batch de apply ao ERP (CatalogMutationService) dentro da
 * transação do tenant. Erro PERMANENTE (monitored / sem external_id / sem
 * credencial / produto sumiu) vira status do item + reason — NÃO re-lança, para
 * o fan-in seguir. Erro TRANSITÓRIO (rede/HTTP do A7) re-lança → o batch
 * re-tenta. Idempotente em redelivery: só processa itens `pending`.
 */
@Injectable()
export class ApplyPriceStep {
  private readonly logger = new Logger(ApplyPriceStep.name);

  constructor(private readonly mutation: CatalogMutationService) {}

  public async run(
    em: EntityManager,
    tenantSlug: string,
    runId: string,
    batchSeq: number,
  ): Promise<void> {
    const items: ItemRow[] = await em.query(
      `SELECT id, ean::text AS ean, target, price, caderno_id::text AS "cadernoId"
         FROM pricing_apply_item
        WHERE apply_run_id = $1 AND batch_seq = $2 AND status = 'pending'`,
      [runId, batchSeq],
    );

    let applied = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of items) {
      // Campanha de oferta ativa: não sobrescrever o preço de VENDA promocional.
      if (
        item.target === 'precoVenda' &&
        (await this.inActiveCampaign(em, item.ean))
      ) {
        await this.mark(em, item.id, 'skipped', 'em_campanha', null);
        skipped++;
        continue;
      }
      try {
        const erpResult = await this.applyOne(em, tenantSlug, item);
        await this.mark(em, item.id, 'applied', null, erpResult);
        applied++;
      } catch (err) {
        const mapped = this.mapPermanent(err);
        if (!mapped) throw err; // transitório → retry do batch inteiro
        await this.mark(em, item.id, mapped.status, mapped.reason, null);
        if (mapped.status === 'skipped') skipped++;
        else failed++;
      }
    }

    await em.query(
      `UPDATE pricing_apply_run
          SET applied = applied + $2, skipped = skipped + $3, failed = failed + $4,
              status = 'running', updated_at = now()
        WHERE id = $1`,
      [runId, applied, skipped, failed],
    );
    this.logger.log(
      `apply-price run ${runId}#${batchSeq}: ${applied} applied, ${skipped} skipped, ${failed} failed`,
    );
  }

  private async applyOne(
    em: EntityManager,
    tenantSlug: string,
    item: ItemRow,
  ): Promise<string> {
    if (item.target === 'precoVenda') {
      const r = await this.mutation.updatePrice(
        em,
        tenantSlug,
        item.ean,
        Number(item.price),
      );
      return `precoVenda=${r.price}`;
    }
    const r = await this.mutation.upsertOffer(em, tenantSlug, item.ean, {
      targetPrice: Number(item.price),
      cadernoId: Number(item.cadernoId),
    });
    return `precoOferta=${r.targetPrice}@caderno=${r.cadernoId}`;
  }

  private async inActiveCampaign(
    em: EntityManager,
    ean: string,
  ): Promise<boolean> {
    const rows: unknown[] = await em.query(
      `SELECT 1 FROM offer_book ob
         JOIN tenant_offer_campaign c ON c.external_id = ob.external_id
        WHERE ob.ean = $1::bigint AND c.active = true
          AND (c.start_date IS NULL OR c.start_date <= now())
          AND (c.expiration_date IS NULL OR c.expiration_date > now())
        LIMIT 1`,
      [ean],
    );
    return rows.length > 0;
  }

  private async mark(
    em: EntityManager,
    id: string,
    status: string,
    reason: string | null,
    erpResult: string | null,
  ): Promise<void> {
    await em.query(
      `UPDATE pricing_apply_item
          SET status = $2, reason = $3, erp_result = $4,
              applied_at = CASE WHEN $2 = 'applied' THEN now() ELSE applied_at END,
              updated_at = now()
        WHERE id = $1`,
      [id, status, reason, erpResult],
    );
  }

  private mapPermanent(err: unknown): Permanent | null {
    if (
      !(err instanceof ConflictException) &&
      !(err instanceof NotFoundException)
    ) {
      return null; // transitório (ex.: erro HTTP/axios do A7)
    }
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('monitored'))
      return { status: 'skipped', reason: 'monitored' };
    if (msg.includes('external_id'))
      return { status: 'skipped', reason: 'sem_external_id' };
    if (msg.includes('not configured'))
      return { status: 'failed', reason: 'a7_nao_configurado' };
    if (err instanceof NotFoundException)
      return { status: 'failed', reason: 'nao_encontrado' };
    return { status: 'failed', reason: 'erp_conflito' };
  }
}
