import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { A7PharmaRepositories } from '../../integration/repositories/a7pharma';
import {
  ProductItemRepository,
  ProductItemUpsertInput,
} from '../../database/repositories/tenant/product-item.repository';

export interface StoreRef {
  id: string;
  externalId: string;
}

interface SyncProductItemsResult {
  processed: number;
}

interface ProductRow {
  id: string;
  ean: string;
  externalId: string;
  price: string | null;
}

/**
 * Per-batch business logic for sync-product-items. Projects per-store
 * price/cost into tenant.product_item for one slice of products across the
 * active stores resolved at dispatch time. Per-store sell price comes from
 * `precoembalagemunidadenegocio` (fallback: the product's global price =
 * embalagem.precovenda); per-store cost from `custoproduto`; the offer
 * price is global (mirrored from tenant offer_book). Each batch runs in its
 * own tenant transaction, so the ERP round-trips don't hold one long
 * transaction open across the whole catalog.
 */
@Injectable()
export class SyncProductItemsStep {
  private readonly logger = new Logger(SyncProductItemsStep.name);

  public async run(
    em: EntityManager,
    integrationDs: DataSource | null,
    productIds: string[],
    stores: StoreRef[],
  ): Promise<SyncProductItemsResult> {
    if (!integrationDs) {
      this.logger.warn(
        'Skipping sync-product-items batch: integration DataSource missing',
      );
      return { processed: 0 };
    }
    if (productIds.length === 0 || stores.length === 0) {
      return { processed: 0 };
    }

    const products: ProductRow[] = await em.query(
      `SELECT id, ean::text AS ean, external_id AS "externalId", price
         FROM product
        WHERE id = ANY($1::uuid[])
          AND external_id IS NOT NULL
          AND deleted_at IS NULL`,
      [productIds],
    );
    if (products.length === 0) return { processed: 0 };

    const a7 = new A7PharmaRepositories(integrationDs);
    const itemRepo = new ProductItemRepository(em);

    // Offers have no per-store dimension on the ERP — mirror the global
    // offer_book value into every store's product_item.
    const eans = products.map((p) => p.ean);
    const offerRows: Array<{ ean: string; targetPrice: string | null }> =
      await em.query(
        `SELECT ean::text AS ean, target_price AS "targetPrice"
           FROM offer_book WHERE ean = ANY($1::bigint[])`,
        [eans],
      );
    const offerByEan = new Map(offerRows.map((o) => [o.ean, o.targetPrice]));

    const embalagemIds = products.map((p) => Number(p.externalId));
    const produtoIdByEmbalagem = new Map<number, number>();
    for (const row of await a7.embalagem.findProdutoIdsByIds(embalagemIds)) {
      produtoIdByEmbalagem.set(row.id, row.produtoid);
    }
    const produtoIds = [...new Set(produtoIdByEmbalagem.values())];

    let processed = 0;
    for (const store of stores) {
      const unidade = Number(store.externalId);
      const [priceRows, costRows] = await Promise.all([
        a7.precoEmbalagemUnidadeNegocio.findByEmbalagemIdsAndUnidade(
          embalagemIds,
          unidade,
        ),
        a7.custoProduto.findByProdutoIdsAndUnidade(produtoIds, unidade),
      ]);
      const priceByEmbalagem = new Map(
        priceRows.map((r) => [r.embalagemid, r.precovenda]),
      );
      const costByProduto = new Map(
        costRows.map((r) => [r.produtoid, r.custo ?? r.customedio]),
      );

      const inputs: ProductItemUpsertInput[] = products.map((p) => {
        const embalagemId = Number(p.externalId);
        const produtoId = produtoIdByEmbalagem.get(embalagemId);
        const perStorePrice = priceByEmbalagem.get(embalagemId);
        return {
          productId: p.id,
          storeId: store.id,
          price: toNumericString(perStorePrice) ?? p.price,
          priceOffer: offerByEan.get(p.ean) ?? null,
          cost:
            produtoId !== undefined
              ? toNumericString(costByProduto.get(produtoId))
              : null,
        };
      });
      await itemRepo.upsertMany(inputs);
      processed += inputs.length;
    }

    this.logger.debug(
      `sync-product-items batch: ${processed} items (${products.length} products × ${stores.length} stores)`,
    );
    return { processed };
  }
}

function toNumericString(value: number | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return String(value);
}
