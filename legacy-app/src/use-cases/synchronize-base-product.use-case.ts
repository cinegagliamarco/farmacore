import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BaseProductOrigin } from '../common/base-product-origin.enum';
import { SYNCHRONIZE_BASE_PRODUCT_USE_CASE } from '../common/import.events';
import { BaseProductTypeormEntity, Deals } from '../database/entities/base-product.entity';
import { ClassificationTypeormEntity } from '../database/entities/classification.entity';
import { OfferBookTypeormEntity } from '../database/entities/offer-book.entity';
import { EmbalagemTypeormEntity } from '../database/integration-entities/embalagem.entity';
import { ItemCadernoOfertaQuantidadeTypeormEntity } from '../database/integration-entities/item-caderno-oferta-quantidade.entity';
import { ItemCadernoOfertaTypeormEntity } from '../database/integration-entities/item-caderno-oferta.entity';
import { ClassificacaoProdutoRepository } from '../database/integration-repositories/classificacao-produto.repository';
import { CustoProdutoRepository } from '../database/integration-repositories/custo-produto.repository';
import { EmbalagemRepository } from '../database/integration-repositories/embalagem.repository';
import { ItemCadernoOfertaQuantidadeRepository } from '../database/integration-repositories/item-caderno-oferta-quantidade.repository';
import { ItemCadernoOfertaRepository } from '../database/integration-repositories/item-caderno-oferta.repository';
import { ItemRecebimentoFisicoRepository } from '../database/integration-repositories/item-recebimento-fisico.repository';
import { ActiveIngredientsRepository } from '../database/repositories/active-ingredients.repository';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ClassificationRepository } from '../database/repositories/classification.repository';
import { OfferBookRepository } from '../database/repositories/offer-book.repository';

@Injectable()
export class SynchronizeBaseProductUseCase {
  private readonly logger = new Logger(SynchronizeBaseProductUseCase.name);
  private BATCH_SIZE = 1000;

  constructor(
    private readonly embalagemRepository: EmbalagemRepository | null,
    private readonly baseProductRepository: BaseProductRepository,
    private readonly classificacaoProdutoRepository: ClassificacaoProdutoRepository | null,
    private readonly custoProdutoRepository: CustoProdutoRepository | null,
    private readonly itemCadernoOfertaRepository: ItemCadernoOfertaRepository | null,
    private readonly itemCadernoOfertaQuantidadeRepository: ItemCadernoOfertaQuantidadeRepository | null,
    private readonly offerBookRepository: OfferBookRepository,
    private readonly itemRecebimentoFisicoRepository: ItemRecebimentoFisicoRepository | null,
    private readonly classificationRepository: ClassificationRepository,
    private readonly activeIngredientsRepository: ActiveIngredientsRepository
  ) {}

  @OnEvent(SYNCHRONIZE_BASE_PRODUCT_USE_CASE)
  public async execute(): Promise<void> {
    try {
      const repos = this.requireIntegrationRepositories();
      if (!repos) {
        this.logger.warn('Skipping SYNCHRONIZE_BASE_PRODUCT_USE_CASE: integration database is not available.');
        return;
      }

      const {
        embalagemRepository,
        classificacaoProdutoRepository,
        custoProdutoRepository,
        itemCadernoOfertaRepository,
        itemCadernoOfertaQuantidadeRepository,
        itemRecebimentoFisicoRepository
      } = repos;

      console.log('Starting product synchronization from embalagem table');

      const totalRecords = await embalagemRepository.countValid();
      console.log(`Total embalagem records to process: ${totalRecords}`);

      await this.offerBookRepository.deleteAll();

      let processedCount = 0;
      let skippedCount = 0;

      for (let offset = 0; offset < totalRecords; offset += this.BATCH_SIZE) {
        console.log(`Fetching batch: ${offset} to ${offset + this.BATCH_SIZE}`);

        const embalagemRecords = await embalagemRepository.findAllValidWithPaginationAndRelations(offset, this.BATCH_SIZE);

        const produtoIds = [...new Set(embalagemRecords.map((r) => r.produtoid).filter(Boolean))] as number[];
        const embalagemIds = embalagemRecords.map((r) => r.id);

        const [classifications, costs, offers, quantities, receiptDates] = await Promise.all([
          classificacaoProdutoRepository.findPrincipalClassificationByProdutoIds(produtoIds),
          custoProdutoRepository.findLatestByProdutoIds(produtoIds),
          itemCadernoOfertaRepository.findBestOffersWithDealsByEmbalagemIds(embalagemIds),
          itemCadernoOfertaQuantidadeRepository.findByEmbalagemIds(embalagemIds),
          itemRecebimentoFisicoRepository.findLatestReceiptDateByEmbalagemIds(embalagemIds)
        ]);

        const quantitiesByEmbalagemId = this.groupQuantitiesByEmbalagemId(quantities);
        const classificationNameByProdutoId = this.buildClassificationNameMap(classifications);

        const uniqueClassificationNames = [...new Set(Object.values(classificationNameByProdutoId))];
        const classificationMap = await this.classificationRepository.upsertBatch(uniqueClassificationNames);

        // Pre-register active ingredient names so the base_product FK never points at a missing row.
        const activeIngredientNames = embalagemRecords
          .filter((r) => r.produtoid && this.isGenericClassification(classificationNameByProdutoId[r.produtoid]))
          .map((r) => r.produto?.principioativo?.nome);
        await this.activeIngredientsRepository.upsertNames(activeIngredientNames);

        const costByProdutoId = this.indexBy(
          costs,
          (c) => c.produtoid,
          (c) => c.custo || c.customedio
        );
        const offerByEmbalagemId = this.indexBy(
          offers,
          (o) => o.embalagemid,
          (o) => o
        );
        const receiptDateByEmbalagemId = this.indexBy(
          receiptDates,
          (r) => r.embalagemid,
          (r) => r.datahora
        );

        // Build all base products in memory (no awaits)
        const baseProductsToSave: BaseProductTypeormEntity[] = [];
        const offerLookups: { ean: number; offer: ItemCadernoOfertaTypeormEntity }[] = [];

        for (const record of embalagemRecords) {
          const ean = this.parseEan(record.codigobarras);
          if (!ean) {
            skippedCount++;
            continue;
          }

          const baseProduct = this.buildBaseProduct(
            record,
            ean,
            classificationNameByProdutoId,
            costByProdutoId,
            classificationMap,
            receiptDateByEmbalagemId[record.id]
          );
          baseProduct.deals = this.buildDeals(quantitiesByEmbalagemId[record.id]);

          baseProductsToSave.push(baseProduct);

          const offer = offerByEmbalagemId[record.id];
          if (offer?.cadernooferta) {
            offerLookups.push({ ean, offer });
          }
        }

        // Bulk upsert base products by EAN, then resolve ids in one query
        const savedByEan = await this.baseProductRepository.upsertManyByEan(baseProductsToSave);

        // Bulk insert offer books
        const offerBooksToSave: OfferBookTypeormEntity[] = [];
        for (const { ean, offer } of offerLookups) {
          const baseProductId = savedByEan.get(ean);
          if (baseProductId) {
            offerBooksToSave.push(this.buildOfferBook(baseProductId, offer));
          }
        }

        if (offerBooksToSave.length > 0) {
          await this.offerBookRepository.bulkInsert(offerBooksToSave);
        }

        processedCount += baseProductsToSave.length;
        console.log(`Processed ${processedCount} products...`);
      }
      console.log(`Product synchronization completed. Processed: ${processedCount}, Skipped: ${skippedCount}`);
    } catch (error) {
      console.error(`Error on SynchronizeBaseProductUseCase: ${error}`);
    }
  }

  private requireIntegrationRepositories(): {
    embalagemRepository: EmbalagemRepository;
    classificacaoProdutoRepository: ClassificacaoProdutoRepository;
    custoProdutoRepository: CustoProdutoRepository;
    itemCadernoOfertaRepository: ItemCadernoOfertaRepository;
    itemCadernoOfertaQuantidadeRepository: ItemCadernoOfertaQuantidadeRepository;
    itemRecebimentoFisicoRepository: ItemRecebimentoFisicoRepository;
  } | null {
    if (
      !this.embalagemRepository ||
      !this.classificacaoProdutoRepository ||
      !this.custoProdutoRepository ||
      !this.itemCadernoOfertaRepository ||
      !this.itemCadernoOfertaQuantidadeRepository ||
      !this.itemRecebimentoFisicoRepository
    ) {
      return null;
    }

    return {
      embalagemRepository: this.embalagemRepository,
      classificacaoProdutoRepository: this.classificacaoProdutoRepository,
      custoProdutoRepository: this.custoProdutoRepository,
      itemCadernoOfertaRepository: this.itemCadernoOfertaRepository,
      itemCadernoOfertaQuantidadeRepository: this.itemCadernoOfertaQuantidadeRepository,
      itemRecebimentoFisicoRepository: this.itemRecebimentoFisicoRepository
    };
  }

  private groupQuantitiesByEmbalagemId(
    quantities: ItemCadernoOfertaQuantidadeTypeormEntity[]
  ): Record<string, ItemCadernoOfertaQuantidadeTypeormEntity[]> {
    const result: Record<string, ItemCadernoOfertaQuantidadeTypeormEntity[]> = {};
    for (const q of quantities) {
      const embalagemId = q.itemcadernooferta?.embalagemid;
      if (embalagemId == null) continue;
      const key = String(embalagemId);
      (result[key] ??= []).push(q);
    }
    return result;
  }

  private buildClassificationNameMap(classifications: { produtoid: number; classificacao?: { caminho?: string } }[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const c of classifications) {
      if (c.classificacao?.caminho) {
        result[c.produtoid] = c.classificacao.caminho.replace(/^PRINCIPAL\s*>\s*/i, '');
      }
    }
    return result;
  }

  private indexBy<T, V>(items: T[], keyFn: (item: T) => string | number | undefined, valueFn: (item: T) => V): Record<string, V> {
    const result: Record<string, V> = {};
    for (const item of items) {
      const key = keyFn(item);
      if (key != null) result[String(key)] = valueFn(item);
    }
    return result;
  }

  private buildBaseProduct(
    record: EmbalagemTypeormEntity,
    ean: number,
    classificationNameByProdutoId: Record<string, string>,
    costByProdutoId: Record<string, number>,
    classificationMap: Map<string, ClassificationTypeormEntity>,
    receiptDate?: Date
  ): BaseProductTypeormEntity {
    const baseProduct = new BaseProductTypeormEntity();
    baseProduct.externalId = record.id;
    baseProduct.ean = ean;
    baseProduct.name = record.descricao || record.apresentacao;
    baseProduct.active = record.produto?.status === 'A';
    baseProduct.price = record.precovenda ? Number(record.precovenda) : undefined;
    baseProduct.description = record.apresentacao;
    baseProduct.averageUnitCost = record.precoreferencial ? Number(record.precoreferencial) : undefined;
    baseProduct.unitSalePrice = record.precovenda ? Number(record.precovenda) : undefined;
    baseProduct.supplier = record.produto?.fabricante?.pessoa?.nome;
    baseProduct.cost = record.produtoid ? costByProdutoId[record.produtoid] : undefined;
    baseProduct.origin = BaseProductOrigin.ERP;
    baseProduct.receiptDate = receiptDate ? this.formatDateToDDMMYYYY(receiptDate) : undefined;
    baseProduct.monitored = record.produto?.tipopreco === 'M';

    // Set classification relationship
    const classificationName = record.produtoid ? classificationNameByProdutoId[record.produtoid] : undefined;
    if (classificationName) {
      const classificationEntity = classificationMap.get(classificationName);
      if (classificationEntity) {
        baseProduct.classificationId = classificationEntity.id;
      }
    }

    if (this.isGenericClassification(classificationName)) {
      baseProduct.activeIngredient = record.produto?.principioativo?.nome;
      baseProduct.generic = true;
    }

    return baseProduct;
  }

  private formatDateToDDMMYYYY(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  private buildDeals(quantidades?: ItemCadernoOfertaQuantidadeTypeormEntity[]): Deals | undefined {
    if (!quantidades?.length) return undefined;

    const deals: Deals = {};
    for (const q of quantidades) {
      deals[q.quantidade] = {
        totalPrice: q.precototal ? Number(q.precototal) : 0,
        discount: q.descontototal ? Number(q.descontototal) : 0,
        itemCadernoOfertaId: q.itemcadernoofertaid
      };
    }

    return deals;
  }

  private buildOfferBook(baseProductId: number, offer: ItemCadernoOfertaTypeormEntity & { effective_price?: number }): OfferBookTypeormEntity {
    const cadernoOferta = offer.cadernooferta!;
    const priceForOffer = offer.effective_price ?? offer.precooferta;

    const offerBook = new OfferBookTypeormEntity();
    offerBook.baseProductId = baseProductId;
    offerBook.name = cadernoOferta.nome;
    offerBook.externalId = cadernoOferta.id;
    offerBook.expirationDate = cadernoOferta.datahorafinal!;
    offerBook.priceForOffer = priceForOffer ? Number(priceForOffer) : null;

    return offerBook;
  }

  private parseEan(codigobarras?: string): number | null {
    if (!codigobarras) return null;

    const cleaned = codigobarras.replace(/\D/g, '');
    if (!cleaned.length || cleaned.length > 14) return null;

    const padded = cleaned.padStart(13, '0');
    const ean = parseInt(padded, 10);

    return isNaN(ean) ? null : ean;
  }

  private isGenericClassification(classification: string): boolean {
    const genericClassifications = [
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
      'GENERICO > TARJADOS'
    ];

    return genericClassifications.includes(classification);
  }
}
