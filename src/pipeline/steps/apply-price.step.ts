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
  storeId: string | null;
  price: string;
  cadernoId: string | null;
}

type Permanent = { status: 'skipped' | 'failed'; reason: string };

/**
 * Aplica os itens de um batch de apply ao ERP (CatalogMutationService) dentro da
 * transação do tenant. **Nunca re-lança** — qualquer erro (permanente ou
 * transitório) vira status do item + reason e o loop segue. Isto é deliberado e
 * money-safe: o push ao A7 é um efeito colateral NÃO-transacional dentro da tx
 * do batch; se um erro num item rolasse a tx inteira, os itens já empurrados ao
 * ERP perderiam o `applied` local e seriam RE-empurrados no redelivery
 * (double-write). Falha transitória → item `failed`/`erro_transitorio`, visível
 * no relatório para reaplicação manual (o operador reenvia só os EANs falhos).
 * Idempotente em redelivery: só processa itens `pending`.
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
      `SELECT id, ean::text AS ean, target, store_id AS "storeId", price,
              caderno_id::text AS "cadernoId"
         FROM pricing_apply_item
        WHERE apply_run_id = $1 AND batch_seq = $2 AND status = 'pending'`,
      [runId, batchSeq],
    );

    // Uma query por batch (não por item): campanhas ativas de todos os EANs
    // precoVenda de uma vez (global) + caderno vencedor por (ean, loja) dos
    // itens de loja + campanhas desses cadernos — checagem em memória no loop.
    const venda = items.filter((i) => i.target === 'precoVenda');
    const inCampaign = await this.activeCampaignEans(
      em,
      venda.map((i) => i.ean),
    );
    const storeCadernos = await this.storeCadernos(
      em,
      venda.filter((i) => i.storeId !== null),
    );
    const campaignCadernos = await this.activeCampaignCadernos(em, [
      ...new Set([...storeCadernos.values()].filter((c): c is string => !!c)),
    ]);

    let applied = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of items) {
      // Campanha de oferta ativa: não sobrescrever o preço de VENDA
      // promocional. Item de loja checa o caderno vencedor DA LOJA (caderno
      // de outra loja não trava esta); loja SEM linha product_item (estado
      // desconhecido, pré-sync) cai na checagem GLOBAL conservadora.
      if (
        item.target === 'precoVenda' &&
        this.emCampanha(item, inCampaign, storeCadernos, campaignCadernos)
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
        // Transitório (rede/HTTP do A7) vira `failed` e segue — NÃO re-lança
        // (re-throw rolaria a tx do batch e re-empurraria itens já aplicados).
        const mapped = this.mapPermanent(err) ?? {
          status: 'failed' as const,
          reason: 'erro_transitorio',
        };
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
        item.storeId ?? undefined,
      );
      return item.storeId
        ? `precoVenda=${r.price}@loja=${item.storeId}`
        : `precoVenda=${r.price}`;
    }
    // Oferta vive no caderno: a escrita vale para TODA loja participante dele,
    // não só a loja do item — anota as afetadas para o relatório (D5).
    // Computado ANTES do push: se falhasse depois, o item viraria 'failed'
    // com o preço JÁ escrito no ERP (double-write num reenvio manual).
    const affected = item.storeId
      ? await this.storesInCaderno(em, tenantSlug, item.ean, item.cadernoId!)
      : null;
    // storeScoped: escrita por loja NÃO reescreve o espelho global offer_book
    // (o caderno da loja pode nem ser/cobrir a melhor oferta da rede).
    const r = await this.mutation.upsertOffer(
      em,
      tenantSlug,
      item.ean,
      { targetPrice: Number(item.price), cadernoId: Number(item.cadernoId) },
      item.storeId !== null,
    );
    return affected
      ? `precoOferta=${r.targetPrice}@caderno=${r.cadernoId};lojas=${affected.join(',') || '?'}`
      : `precoOferta=${r.targetPrice}@caderno=${r.cadernoId}`;
  }

  /** Lojas DO TENANT cujo caderno vencedor para este EAN é o caderno escrito
   *  (estado do último sync — o alcance honesto da escrita). */
  private async storesInCaderno(
    em: EntityManager,
    tenantSlug: string,
    ean: string,
    cadernoId: string,
  ): Promise<string[]> {
    const rows: Array<{ name: string }> = await em.query(
      `SELECT ts.name FROM product_item pi
         JOIN product p ON p.id = pi.product_id
         JOIN core.tenant_store ts ON ts.id = pi.store_id
         JOIN core.tenant t ON t.id = ts.tenant_id AND t.slug = $3
        WHERE p.ean = $1::bigint AND pi.offer_external_id = $2::bigint
        ORDER BY ts.name`,
      [ean, cadernoId, tenantSlug],
    );
    return rows.map((r) => r.name);
  }

  private async activeCampaignEans(
    em: EntityManager,
    eans: string[],
  ): Promise<Set<string>> {
    if (eans.length === 0) return new Set();
    const rows: Array<{ ean: string }> = await em.query(
      `SELECT DISTINCT ob.ean::text AS ean FROM offer_book ob
         JOIN tenant_offer_campaign c ON c.external_id = ob.external_id
        WHERE ob.ean = ANY($1::bigint[]) AND c.active = true
          AND (c.start_date IS NULL OR c.start_date <= now())
          AND (c.expiration_date IS NULL OR c.expiration_date > now())`,
      [eans],
    );
    return new Set(rows.map((r) => r.ean));
  }

  /** Caderno vencedor por (ean, loja) dos itens de loja, keyed `ean|storeId`.
   *  Chave ausente = loja SEM linha product_item (estado desconhecido). */
  private async storeCadernos(
    em: EntityManager,
    storeItems: ItemRow[],
  ): Promise<Map<string, string | null>> {
    if (storeItems.length === 0) return new Map();
    const rows: Array<{
      ean: string;
      storeId: string;
      offerExternalId: string | null;
    }> = await em.query(
      `SELECT p.ean::text AS ean, pi.store_id AS "storeId",
              pi.offer_external_id::text AS "offerExternalId"
         FROM product_item pi
         JOIN product p ON p.id = pi.product_id
        WHERE p.ean = ANY($1::bigint[]) AND pi.store_id = ANY($2::uuid[])`,
      [
        [...new Set(storeItems.map((i) => i.ean))],
        [...new Set(storeItems.map((i) => i.storeId!))],
      ],
    );
    return new Map(
      rows.map((r) => [`${r.ean}|${r.storeId}`, r.offerExternalId]),
    );
  }

  private async activeCampaignCadernos(
    em: EntityManager,
    cadernos: string[],
  ): Promise<Set<string>> {
    if (cadernos.length === 0) return new Set();
    const rows: Array<{ id: string }> = await em.query(
      `SELECT DISTINCT c.external_id::text AS id FROM tenant_offer_campaign c
        WHERE c.external_id = ANY($1::bigint[]) AND c.active = true
          AND (c.start_date IS NULL OR c.start_date <= now())
          AND (c.expiration_date IS NULL OR c.expiration_date > now())`,
      [cadernos],
    );
    return new Set(rows.map((r) => r.id));
  }

  private emCampanha(
    item: ItemRow,
    inCampaign: Set<string>,
    storeCadernos: Map<string, string | null>,
    campaignCadernos: Set<string>,
  ): boolean {
    if (!item.storeId) return inCampaign.has(item.ean);
    const key = `${item.ean}|${item.storeId}`;
    if (!storeCadernos.has(key)) return inCampaign.has(item.ean);
    const caderno = storeCadernos.get(key);
    return caderno != null && campaignCadernos.has(caderno);
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
    if (msg.includes('inactive'))
      return { status: 'skipped', reason: 'loja_inativa' };
    if (msg.includes('external_id'))
      return { status: 'skipped', reason: 'sem_external_id' };
    if (msg.includes('not configured'))
      return { status: 'failed', reason: 'a7_nao_configurado' };
    if (err instanceof NotFoundException)
      return { status: 'failed', reason: 'nao_encontrado' };
    return { status: 'failed', reason: 'erp_conflito' };
  }
}
