import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  A7PharmaRepositories,
  ItemCadernoOfertaWithPrice,
  LatestReceiptDate,
  parseEan,
} from '../../integration/repositories/a7pharma';
import { ItemCadernoOfertaQuantidadeEntity } from '../../integration/entities/a7pharma/item-caderno-oferta-quantidade.entity';
import { ClassificacaoProdutoEntity } from '../../integration/entities/a7pharma/classificacao-produto.entity';
import { CustoProdutoEntity } from '../../integration/entities/a7pharma/custo-produto.entity';
import {
  BaseProductRepository,
  BaseProductUpsertInput,
} from '../../database/repositories/shared-catalog/base-product.repository';
import {
  ProductRepository,
  ProductUpsertInput,
} from '../../database/repositories/tenant/product.repository';
import { ClassificationRepository } from '../../database/repositories/tenant/classification.repository';
import {
  OfferBookRepository,
  OfferBookUpsertInput,
} from '../../database/repositories/tenant/offer-book.repository';
import { ProductDeal } from '../../database/entities/tenant/product.entity';

interface SyncBaseProductBatchResult {
  processed: number;
  skipped: number;
}

/**
 * Per-batch business logic for sync-base-product. Pure use-case: takes
 * the tenant EntityManager + integration DataSource + a slice of
 * embalagem IDs; reads from the ERP, writes to shared_catalog and the
 * tenant schema; no RMQ awareness.
 *
 * Field mapping (legacy BaseProductEntity -> new model):
 *   ean, description, activeIngredient, generic -> shared_catalog.base_product
 *   external_id, name, active, price, cost, average_unit_cost,
 *     unit_sale_price, supplier, receipt_date, monitored,
 *     classification_id, deals -> tenant.product
 *   ean, description, target_price -> tenant.offer_book
 */
@Injectable()
export class SyncBaseProductStep {
  private readonly logger = new Logger(SyncBaseProductStep.name);

  public async run(
    em: EntityManager,
    integrationDs: DataSource | null,
    embalagemIds: number[],
  ): Promise<SyncBaseProductBatchResult> {
    if (!integrationDs) {
      this.logger.warn(
        'Skipping sync-base-product batch: integration DataSource not available for tenant',
      );
      return { processed: 0, skipped: embalagemIds.length };
    }
    if (embalagemIds.length === 0) return { processed: 0, skipped: 0 };

    const a7 = new A7PharmaRepositories(integrationDs);
    const baseProductRepo = new BaseProductRepository(em);
    const productRepo = new ProductRepository(em);
    const classificationRepo = new ClassificationRepository(em);
    const offerBookRepo = new OfferBookRepository(em);

    const embalagens = await a7.embalagem.findByIdsWithRelations(embalagemIds);
    if (embalagens.length === 0) return { processed: 0, skipped: 0 };

    const produtoIds = [
      ...new Set(
        embalagens
          .map((e) => e.produtoid)
          .filter((id): id is number => id != null),
      ),
    ];
    const observedIds = embalagens.map((e) => e.id);

    const [classifications, costs, offers, quantities, receiptDates] =
      await Promise.all([
        a7.classificacaoProduto.findPrincipalClassificationByProdutoIds(
          produtoIds,
        ),
        a7.custoProduto.findLatestByProdutoIds(produtoIds),
        a7.itemCadernoOferta.findBestOffersWithDealsByEmbalagemIds(observedIds),
        a7.itemCadernoOfertaQuantidade.findByEmbalagemIds(observedIds),
        a7.itemRecebimentoFisico.findLatestReceiptDateByEmbalagemIds(
          observedIds,
        ),
      ]);

    const classificationPathByProdutoId =
      this.buildClassificationPathMap(classifications);
    const quantitiesByEmbalagemId =
      this.groupQuantitiesByEmbalagemId(quantities);
    const costByProdutoId = this.indexCostByProdutoId(costs);
    const offerByEmbalagemId = this.indexOfferByEmbalagemId(offers);
    const receiptDateByEmbalagemId =
      this.indexReceiptDateByEmbalagemId(receiptDates);

    const uniqueClassificationPaths = [
      ...new Set(Object.values(classificationPathByProdutoId)),
    ];
    const classificationIdByPath = await classificationRepo.upsertPaths(
      uniqueClassificationPaths,
    );

    const baseProductInputs: BaseProductUpsertInput[] = [];
    const productSeeds: Array<
      Omit<ProductUpsertInput, 'classificationId'> & {
        classificationPath?: string;
      }
    > = [];
    const offerInputs: OfferBookUpsertInput[] = [];
    let skipped = 0;

    for (const record of embalagens) {
      const ean = parseEan(record.codigobarras);
      if (!ean) {
        skipped++;
        continue;
      }

      const classificationPath = record.produtoid
        ? classificationPathByProdutoId[String(record.produtoid)]
        : undefined;
      const isGeneric = this.isGenericClassification(classificationPath);
      const activeIngredient = isGeneric
        ? (record.produto?.principioativo?.nome ?? null)
        : null;

      baseProductInputs.push({
        ean,
        description: record.apresentacao ?? null,
        activeIngredient,
        generic: isGeneric,
      });

      productSeeds.push({
        ean,
        externalId: record.id != null ? String(record.id) : null,
        name: record.descricao || record.apresentacao || null,
        active: record.produto?.status === 'A',
        price: this.toNumericString(record.precovenda),
        cost: this.toNumericString(
          record.produtoid != null
            ? costByProdutoId[String(record.produtoid)]
            : undefined,
        ),
        averageUnitCost: this.toNumericString(record.precoreferencial),
        unitSalePrice: this.toNumericString(record.precovenda),
        supplier: record.produto?.fabricante?.pessoa?.nome ?? null,
        receiptDate: receiptDateByEmbalagemId[String(record.id)] ?? null,
        monitored: record.produto?.tipopreco === 'M',
        classificationPath,
        deals: this.buildDeals(quantitiesByEmbalagemId[String(record.id)]),
      });

      const offer = offerByEmbalagemId[String(record.id)];
      if (offer?.cadernooferta) {
        const target =
          offer.effective_price != null
            ? offer.effective_price
            : offer.precooferta;
        offerInputs.push({
          ean,
          description: offer.cadernooferta.nome ?? null,
          targetPrice: this.toNumericString(target),
        });
      }
    }

    await baseProductRepo.upsertManyByEan(baseProductInputs);

    const productInputs: ProductUpsertInput[] = productSeeds.map((seed) => {
      const { classificationPath, ...rest } = seed;
      return {
        ...rest,
        classificationId: classificationPath
          ? (classificationIdByPath.get(classificationPath) ?? null)
          : null,
      };
    });
    await productRepo.upsertManyByEan(productInputs);

    await offerBookRepo.upsertManyByEan(offerInputs);

    this.logger.debug(
      `sync-base-product batch: ${productInputs.length} products, ${offerInputs.length} offers, ${skipped} skipped`,
    );
    return { processed: productInputs.length, skipped };
  }

  private buildClassificationPathMap(
    rows: ClassificacaoProdutoEntity[],
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (row.produtoid == null || !row.classificacao?.caminho) continue;
      out[String(row.produtoid)] = row.classificacao.caminho.replace(
        /^PRINCIPAL\s*>\s*/i,
        '',
      );
    }
    return out;
  }

  private groupQuantitiesByEmbalagemId(
    rows: ItemCadernoOfertaQuantidadeEntity[],
  ): Record<string, ItemCadernoOfertaQuantidadeEntity[]> {
    const out: Record<string, ItemCadernoOfertaQuantidadeEntity[]> = {};
    for (const q of rows) {
      const embalagemId = q.itemcadernooferta?.embalagemid;
      if (embalagemId == null) continue;
      (out[String(embalagemId)] ??= []).push(q);
    }
    return out;
  }

  private indexCostByProdutoId(
    costs: CustoProdutoEntity[],
  ): Record<string, number | undefined> {
    const out: Record<string, number | undefined> = {};
    for (const c of costs) {
      if (c.produtoid == null) continue;
      const value = c.custo ?? c.customedio;
      out[String(c.produtoid)] = value != null ? Number(value) : undefined;
    }
    return out;
  }

  private indexOfferByEmbalagemId(
    offers: ItemCadernoOfertaWithPrice[],
  ): Record<string, ItemCadernoOfertaWithPrice> {
    const out: Record<string, ItemCadernoOfertaWithPrice> = {};
    for (const o of offers) {
      if (o.embalagemid == null) continue;
      out[String(o.embalagemid)] = o;
    }
    return out;
  }

  private indexReceiptDateByEmbalagemId(
    rows: LatestReceiptDate[],
  ): Record<string, Date> {
    const out: Record<string, Date> = {};
    for (const r of rows) {
      if (r.embalagemid == null || r.datahora == null) continue;
      out[String(r.embalagemid)] = new Date(r.datahora);
    }
    return out;
  }

  private buildDeals(
    quantidades?: ItemCadernoOfertaQuantidadeEntity[],
  ): Record<string, ProductDeal> | null {
    if (!quantidades?.length) return null;
    const deals: Record<string, ProductDeal> = {};
    for (const q of quantidades) {
      deals[String(q.quantidade)] = {
        totalPrice: q.precototal != null ? Number(q.precototal) : 0,
        discount: q.descontototal != null ? Number(q.descontototal) : 0,
        itemCadernoOfertaId: q.itemcadernoofertaid ?? null,
      };
    }
    return deals;
  }

  private toNumericString(value: unknown): string | null {
    if (value == null) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num.toString();
  }

  private isGenericClassification(classification?: string): boolean {
    if (!classification) return false;
    const generics = [
      'GENERICO > ANTICONCEPCIONAL',
      'GENERICO > GENERICO 01',
      'GENERICO > OTC',
      'GENERICO > PSICOS GENERICO > A1-GEN',
      'GENERICO > PSICOS GENERICO > A2-GEN',
      'GENERICO > PSICOS GENERICO > A3-GEN',
      'GENERICO > PSICOS GENERICO > B1-GEN',
      'GENERICO > PSICOS GENERICO > B2-GEN',
      'GENERICO > PSICOS GENERICO > C1-GEN',
      'GENERICO > PSICOS GENERICO > C2-GEN',
      'GENERICO > PSICOS GENERICO > C5-GEN',
      'GENERICO > PSICOS GENERICO > GENÉRICO ANTIBIOTICO',
      'GENERICO > TARJADOS',
    ];
    return generics.includes(classification);
  }
}
