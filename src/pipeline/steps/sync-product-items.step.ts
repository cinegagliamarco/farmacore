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
  externalId: string;
}

/**
 * Per-batch business logic for sync-product-items. Projects per-store
 * price/cost/offer into tenant.product_item for one slice of products across
 * the active stores resolved at dispatch time. Per-store sell price comes
 * from `precoembalagemunidadenegocio`; when the ERP has no per-store row,
 * price stays NULL — reads COALESCE to the live global product.price, so no
 * stale snapshot is stored here. Per-store cost from `custoproduto`. The
 * offer is the store's winning caderno (`findStoreOffers`, participation via
 * unidadenegocioparticipantecadernooferta): caderno id/name always recorded
 * when the product belongs to one at the store; price_offer only when the
 * offer undercuts the store's shelf price (an "offer" above it is not what
 * the customer pays). Each batch runs in its own tenant transaction, so the
 * ERP round-trips don't hold one long transaction open across the catalog.
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
      `SELECT id, external_id AS "externalId"
         FROM product
        WHERE id = ANY($1::uuid[])
          AND external_id IS NOT NULL
          AND deleted_at IS NULL`,
      [productIds],
    );
    if (products.length === 0) return { processed: 0 };

    const a7 = new A7PharmaRepositories(integrationDs);
    const itemRepo = new ProductItemRepository(em);

    const embalagemIds = products.map((p) => Number(p.externalId));
    const produtoIdByEmbalagem = new Map<number, number>();
    for (const row of await a7.embalagem.findProdutoIdsByIds(embalagemIds)) {
      produtoIdByEmbalagem.set(row.id, row.produtoid);
    }
    const produtoIds = [...new Set(produtoIdByEmbalagem.values())];

    // One query resolves the winning caderno offer of every (embalagem × store).
    const offerByStoreEmbalagem = new Map(
      (
        await a7.itemCadernoOferta.findStoreOffers(
          embalagemIds,
          stores.map((s) => Number(s.externalId)),
        )
      ).map((o) => [`${o.unidadenegocioid}|${o.embalagemid}`, o]),
    );

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
        const offer = offerByStoreEmbalagem.get(`${unidade}|${embalagemId}`);
        const undercuts =
          offer?.precoFinalOferta != null &&
          (offer.precoCadastro == null ||
            offer.precoFinalOferta <= offer.precoCadastro);
        return {
          productId: p.id,
          storeId: store.id,
          price: toNumericString(perStorePrice),
          priceOffer: undercuts
            ? toNumericString(offer.precoFinalOferta)
            : null,
          cost:
            produtoId !== undefined
              ? toNumericString(costByProduto.get(produtoId))
              : null,
          offerExternalId: offer ? String(offer.cadernoofertaid) : null,
          offerDescription: offer?.cadernoNome ?? null,
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

function toNumericString(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return String(value);
}
