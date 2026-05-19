import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { CreatePriceLockBodyDto, CreatePricingRuleBodyDto, PreviewProductResult } from '../dto/offer-book-rules-body.dto';
import { OfferBookRulesService, ProductWithPrices } from '../services/offer-book-rules.service';
import { A7PharmaApiService } from '../services/a7-pharma-api.service';
import { OfferBookRulesExecutionReportRepository } from '../database/repositories/offer-book-rules-execution-report.repository';
import { CalculationBaseType } from '../common/calculation-base-type.enum';
import { ExecutionType } from '../common/execution-type.enum';
import { ExecutionOutcome } from '../common/execution-outcome.enum';
import { OfferBookRulesStatus } from '../common/offer-book-rules-status.enum';
import { EXECUTE_OFFER_BOOK_RULES_EVENT } from '../common/import.events';
import { OfferBookRulesExecutionReportTypeormEntity } from '../database/entities/offer-book-rules-execution-report.entity';
import { OfferBookRulesExecutionReportItemTypeormEntity } from '../database/entities/offer-book-rules-execution-report-item.entity';
import { Origin } from '../common/origin.enum';
import { PriceBaseSource } from '../common/price-base-source.enum';

export interface ExecuteOfferBookRulesResult {
  offerBookRulesId: number;
  offerBookInfoId: number;
  totalProducts: number;
  productsUpdated: number;
  productsSkipped: number;
  executedAt: Date;
  executionReportId: number;
}

export interface StartExecuteOfferBookRulesResult {
  message: string;
  offerBookRulesId: number;
}

interface UpdateOfferBookPricesBatchResult {
  totalBatches: number;
  successfulBatches: number;
  failedBatches: number;
  errors: string[];
}

interface ChunkWithProducts {
  items: { idEmbalagem: number; precoOferta: number }[];
  products: PreviewProductResult[];
}

@Injectable()
export class ExecuteOfferBookRulesUseCase implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExecuteOfferBookRulesUseCase.name);

  constructor(
    private readonly offerBookRulesRepository: OfferBookRulesRepository,
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly offerBookRulesService: OfferBookRulesService,
    private readonly a7PharmaApiService: A7PharmaApiService,
    private readonly executionReportRepository: OfferBookRulesExecutionReportRepository,
    private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository,
    private readonly eventEmitter: EventEmitter2
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    const affected = await this.offerBookRulesRepository.resetStuckRunningStatus();
    if (affected > 0) {
      this.logger.warn(`Reset ${affected} offer book rule(s) stuck in RUNNING status from a previous crash`);
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    const affected = await this.offerBookRulesRepository.resetStuckRunningStatus();
    if (affected > 0) {
      this.logger.warn(`Shutdown: reset ${affected} offer book rule(s) stuck in RUNNING status`);
    }
  }

  public async startExecution(id: number): Promise<StartExecuteOfferBookRulesResult> {
    const rules = await this.offerBookRulesRepository.findById(id);

    if (!rules) {
      throw new NotFoundException(`Offer book rules with ID ${id} not found`);
    }

    if (rules.status === OfferBookRulesStatus.RUNNING) {
      throw new BadRequestException(`Offer book rules ${id} is already being executed`);
    }

    this.eventEmitter.emit(EXECUTE_OFFER_BOOK_RULES_EVENT, { id });

    return { message: 'Execution started', offerBookRulesId: id };
  }

  @OnEvent(EXECUTE_OFFER_BOOK_RULES_EVENT)
  public async handleExecuteEvent({ id }: { id: number }): Promise<void> {
    try {
      await this.execute(id);
    } catch (error) {
      this.logger.error(`Error executing offer book rules ${id} in background`, error);
      await this.offerBookRulesRepository.updateStatus(id, OfferBookRulesStatus.ERRORED);
    }
  }

  public async execute(id: number, executionType: ExecutionType = ExecutionType.MANUAL): Promise<ExecuteOfferBookRulesResult | null> {
    await this.offerBookRulesRepository.updateStatus(id, OfferBookRulesStatus.RUNNING);

    try {
      const offerBookRules = await this.offerBookRulesRepository.findById(id);

      if (!offerBookRules) {
        await this.offerBookRulesRepository.updateStatus(id, OfferBookRulesStatus.IDLE);
        throw new NotFoundException(`Offer book rules with ID ${id} not found`);
      }

      let baseProducts: BaseProductTypeormEntity[];

      if (offerBookRules.groupedClassifications && offerBookRules.groupedClassifications.length > 0) {
        baseProducts = await this.baseProductRepository.findActiveByGroupedClassifications(offerBookRules.groupedClassifications);
      } else {
        const productIds = await this.offerBookRulesRepository.findProductIdsByRulesId(id);

        if (productIds.length === 0) {
          const executedAt = new Date();
          const report = await this.createReportHeader(
            {
              offerBookRulesId: id,
              offerBookInfoId: offerBookRules.offerBookInfoId,
              totalProducts: 0,
              productsUpdated: 0,
              productsSkipped: 0,
              executedAt
            },
            executionType,
            offerBookRules.calculationBaseType
          );
          await this.executionReportRepository.updateHeader(report.id, {
            totalProducts: 0,
            productsUpdated: 0,
            productsSkipped: 0,
            outcome: ExecutionOutcome.NO_CHANGES,
            errorMessage: null
          });

          await this.offerBookRulesRepository.updateStatus(id, OfferBookRulesStatus.SUCCEEDED);

          return {
            offerBookRulesId: id,
            offerBookInfoId: offerBookRules.offerBookInfoId,
            totalProducts: 0,
            productsUpdated: 0,
            productsSkipped: 0,
            executedAt,
            executionReportId: report.id
          };
        }

        baseProducts = await this.findActiveBaseProductsByIdsBatched(productIds);
      }

      if (baseProducts.length === 0) {
        await this.offerBookRulesRepository.updateStatus(id, OfferBookRulesStatus.SUCCEEDED);
        return null;
      }

      const pricingRules: CreatePricingRuleBodyDto[] = offerBookRules.pricingRules.map((rule) => ({
        classifications: rule.classifications ?? undefined,
        priceRangeMin: rule.priceRangeMin ?? undefined,
        priceRangeMax: rule.priceRangeMax ?? undefined,
        marginRangeMin: rule.marginRangeMin ?? undefined,
        marginRangeMax: rule.marginRangeMax ?? undefined,
        actionType: rule.actionType,
        percentageValue: rule.percentageValue,
        active: rule.active
      }));

      const priceLocks: CreatePriceLockBodyDto[] = offerBookRules.priceLocks.map((lock) => ({
        classifications: lock.classifications ?? undefined,
        minMargin: lock.minMargin,
        active: lock.active
      }));

      const normalizedPricingRules = this.offerBookRulesService.normalizePricingRulesClassifications(pricingRules);
      const normalizedPriceLocks = this.offerBookRulesService.normalizePriceLocksClassifications(priceLocks);

      const productsWithPrices = await this.getProductsWithPrices(
        baseProducts,
        offerBookRules.calculationBaseType,
        offerBookRules.priceBaseSources ?? undefined
      );
      const priceRoundingRules = offerBookRules.applyPriceRounding ? await this.priceRoundingRuleRepository.findAllActive() : [];

      const calculatedProducts = this.offerBookRulesService.calculateProductPreviews(productsWithPrices, {
        calculationBaseType: offerBookRules.calculationBaseType,
        priceBaseSources: offerBookRules.priceBaseSources ?? undefined,
        pricingRules: normalizedPricingRules,
        priceLocks: normalizedPriceLocks,
        priceRoundingRules
      });

      // Filter products that have price changes (excluding those skipped)
      const productsToUpdate = calculatedProducts.filter(
        (p) => !p.skippedNoCompetitorPrice && !p.skippedPriceExceedsLimit && p.finalPrice !== p.currentPrice
      );
      const productsSkipped = calculatedProducts.filter(
        (p) => p.skippedNoCompetitorPrice || p.skippedPriceExceedsLimit || p.finalPrice === p.currentPrice
      );

      const executedAt = new Date();

      const report = await this.createReportHeader(
        {
          offerBookRulesId: id,
          offerBookInfoId: offerBookRules.offerBookInfoId,
          totalProducts: calculatedProducts.length,
          productsUpdated: productsToUpdate.length,
          productsSkipped: productsSkipped.length,
          executedAt
        },
        executionType,
        offerBookRules.calculationBaseType
      );

      const skippedItems = this.buildReportItems(productsSkipped);
      await this.executionReportRepository.appendItems(report.id, skippedItems);

      let outcome: ExecutionOutcome;
      let finalStatus: OfferBookRulesStatus;
      let errorMessage: string | null = null;

      if (productsToUpdate.length > 0) {
        const apiResult = await this.updateOfferBookPrices(offerBookRules.offerBookInfo.externalId, productsToUpdate, async (successfulProducts) => {
          const items = this.buildReportItems(successfulProducts);
          await this.executionReportRepository.appendItems(report.id, items);
        });

        if (apiResult.failedBatches === 0) {
          outcome = ExecutionOutcome.SUCCESS;
          finalStatus = OfferBookRulesStatus.SUCCEEDED;
          this.logger.log(`Executed offer book rules ${id}: ${productsToUpdate.length} products updated, ${productsSkipped.length} products skipped`);
        } else if (apiResult.successfulBatches === 0) {
          outcome = ExecutionOutcome.FAILURE;
          finalStatus = OfferBookRulesStatus.ERRORED;
          errorMessage = apiResult.errors.join('; ');
          this.logger.error(`Failed to update prices for offer book rules ${id}: ${errorMessage}`);
        } else {
          outcome = ExecutionOutcome.FAILURE;
          finalStatus = OfferBookRulesStatus.PARTIALLY_SUCCEEDED;
          errorMessage = `Partial failure (${apiResult.failedBatches}/${apiResult.totalBatches} batches failed): ${apiResult.errors.join('; ')}`;
          this.logger.warn(
            `Partially executed offer book rules ${id}: ${apiResult.successfulBatches}/${apiResult.totalBatches} batches succeeded, ${productsSkipped.length} products skipped`
          );
        }
      } else {
        outcome = ExecutionOutcome.NO_CHANGES;
        finalStatus = OfferBookRulesStatus.SUCCEEDED;
        this.logger.log(`Executed offer book rules ${id}: No products to update, ${productsSkipped.length} products skipped`);
      }

      await this.executionReportRepository.updateHeader(report.id, {
        totalProducts: calculatedProducts.length,
        productsUpdated: productsToUpdate.length,
        productsSkipped: productsSkipped.length,
        outcome,
        errorMessage: errorMessage ?? null
      });

      await this.offerBookRulesRepository.updateStatus(id, finalStatus);

      return {
        offerBookRulesId: id,
        offerBookInfoId: offerBookRules.offerBookInfoId,
        totalProducts: calculatedProducts.length,
        productsUpdated: productsToUpdate.length,
        productsSkipped: productsSkipped.length,
        executedAt,
        executionReportId: report.id
      };
    } catch (error) {
      await this.offerBookRulesRepository.updateStatus(id, OfferBookRulesStatus.ERRORED);
      throw error;
    }
  }

  private async createReportHeader(
    result: {
      offerBookRulesId: number;
      offerBookInfoId: number;
      totalProducts: number;
      productsUpdated: number;
      productsSkipped: number;
      executedAt: Date;
    },
    executionType: ExecutionType,
    calculationBaseType: CalculationBaseType
  ): Promise<OfferBookRulesExecutionReportTypeormEntity> {
    const report = new OfferBookRulesExecutionReportTypeormEntity();
    report.offerBookRulesId = result.offerBookRulesId;
    report.offerBookInfoId = result.offerBookInfoId;
    report.executedAt = result.executedAt;
    report.executionType = executionType;
    report.calculationBaseType = calculationBaseType;
    report.totalProducts = result.totalProducts;
    report.productsUpdated = result.productsUpdated;
    report.productsSkipped = result.productsSkipped;
    report.outcome = ExecutionOutcome.SUCCESS;
    report.errorMessage = null;
    report.items = [];
    return this.executionReportRepository.save(report);
  }

  private buildReportItems(products: PreviewProductResult[]): OfferBookRulesExecutionReportItemTypeormEntity[] {
    return products.map((product) => {
      const item = new OfferBookRulesExecutionReportItemTypeormEntity();
      item.ean = product.ean;
      item.name = product.name;
      item.classification = product.classification;
      item.baseSalePrice = product.baseSalePrice;
      item.currentPrice = product.currentPrice;
      item.currentMargin = product.currentMargin;
      item.cost = product.cost;
      item.actionType = product.actionType;
      item.percentageValue = product.percentageValue;
      item.appliedPercentageValue = product.appliedPercentageValue;
      item.finalPrice = product.finalPrice;
      item.newMargin = product.newMargin;
      item.priceLockApplied = product.priceLockApplied;
      item.discountSkipped = product.discountSkipped;
      item.skippedNoCompetitorPrice = product.skippedNoCompetitorPrice;
      item.skippedPriceExceedsLimit = product.skippedPriceExceedsLimit;
      item.priceRoundingApplied = product.priceRoundingApplied;
      item.wasUpdated = !product.skippedNoCompetitorPrice && !product.skippedPriceExceedsLimit && product.finalPrice !== product.currentPrice;
      return item;
    });
  }

  private async updateOfferBookPrices(
    idCadernoOferta: number,
    products: PreviewProductResult[],
    onChunkSuccess: (products: PreviewProductResult[]) => Promise<void>
  ): Promise<UpdateOfferBookPricesBatchResult> {
    const BATCH_SIZE = 80;

    const chunks: ChunkWithProducts[] = [];
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const chunkProducts = products.slice(i, i + BATCH_SIZE);
      chunks.push({
        items: chunkProducts.map((p) => ({ idEmbalagem: p.externalId, precoOferta: p.finalPrice })),
        products: chunkProducts
      });
    }

    this.logger.log(`Processing ${products.length} products in ${chunks.length} chunk(s) of up to ${BATCH_SIZE}`);

    const results: Array<{ success: boolean; error?: string; statusCode?: number }> = [];
    const errors: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      this.logger.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.items.length} products)`);

      const result = await this.a7PharmaApiService
        .createOrUpdateOffers({ idCadernoOferta, items: chunk.items })
        .then((r) => {
          if (r.success) {
            this.logger.log(`Chunk ${i + 1}/${chunks.length} completed successfully`);
          } else {
            this.logger.error(`Chunk ${i + 1}/${chunks.length} failed: ${r.error || 'API returned status ' + r.statusCode}`, r.data);
          }
          return r;
        })
        .catch((error) => {
          const errorMsg = `Chunk ${i + 1}/${chunks.length} failed with unexpected error: ${error.message || error}`;
          this.logger.error(errorMsg, error);
          return {
            success: false,
            error: errorMsg,
            statusCode: error.statusCode || error.response?.status || 500,
            data: error.response?.data
          };
        });

      if (result.success) {
        try {
          await onChunkSuccess(chunk.products);
        } catch (reportError) {
          this.logger.error(`Failed to save report items for chunk ${i + 1}/${chunks.length}`, reportError);
        }
      } else {
        errors.push(this.buildChunkErrorMessage(i + 1, chunks.length, result));
      }

      results.push(result);

      if (i < chunks.length - 1) {
        this.logger.log(`Awaiting 5 seconds before next chunk`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    const successfulBatches = results.filter((r) => r.success).length;
    const failedBatches = results.filter((r) => !r.success).length;

    if (failedBatches > 0) {
      this.logger.error(`${failedBatches}/${results.length} chunks failed`);
    } else {
      this.logger.log(`Successfully processed all ${chunks.length} chunks (${products.length} products total)`);
    }

    return {
      totalBatches: results.length,
      successfulBatches,
      failedBatches,
      errors
    };
  }

  private buildChunkErrorMessage(chunkNumber: number, totalChunks: number, result: { error?: string; statusCode?: number; data?: unknown }): string {
    const parts: string[] = [`Chunk ${chunkNumber}/${totalChunks} failed`];

    if (result.statusCode) {
      parts.push(`HTTP ${result.statusCode}`);
    }

    if (result.error) {
      parts.push(result.error);
    }

    if (result.data !== undefined && result.data !== null) {
      const dataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      if (dataStr) {
        parts.push(`API response: ${dataStr}`);
      }
    }

    return parts.join(' | ');
  }

  private async findActiveBaseProductsByIdsBatched(ids: number[], batchSize: number = 1000): Promise<BaseProductTypeormEntity[]> {
    const results: BaseProductTypeormEntity[] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const rows = await this.baseProductRepository.findActiveByIds(batch);
      results.push(...rows);
    }
    return results;
  }

  private async getPricesByEansAndOriginsBatched(
    eans: number[],
    origins: Origin[],
    batchSize: number = 1000
  ): Promise<Map<string, Map<Origin, number>>> {
    const map = new Map<string, Map<Origin, number>>();
    for (let i = 0; i < eans.length; i += batchSize) {
      const batch = eans.slice(i, i + batchSize);
      const batchMap = await this.productRepository.getPricesByEansAndOrigins(batch, origins);
      for (const [ean, pricesByOrigin] of batchMap) {
        map.set(ean, pricesByOrigin);
      }
    }
    return map;
  }

  private async getProductsWithPrices(
    baseProducts: BaseProductTypeormEntity[],
    calculationBaseType: CalculationBaseType,
    priceBaseSources?: PriceBaseSource[]
  ): Promise<ProductWithPrices[]> {
    const eans = baseProducts.map((bp) => bp.ean);

    let pricesByOrigin = new Map<string, Map<Origin, number>>();

    if (calculationBaseType === CalculationBaseType.COMPETITIVE_PRICE && priceBaseSources && priceBaseSources.length > 0) {
      const origins = priceBaseSources
        .filter((source) => source !== PriceBaseSource.OWN_PRICE)
        .map((source) => {
          const originMap: Record<string, Origin> = {
            [PriceBaseSource.DROGAL]: Origin.DROGAL,
            [PriceBaseSource.DROGASIL]: Origin.DROGASIL,
            [PriceBaseSource.PAGUE_MENOS]: Origin.PAGUE_MENOS,
            [PriceBaseSource.IKESAKI]: Origin.IKESAKI,
            [PriceBaseSource.MICHELASSI]: Origin.MICHELASSI
          };
          return originMap[source];
        })
        .filter((origin): origin is Origin => origin !== undefined);

      if (origins.length > 0) {
        pricesByOrigin = await this.getPricesByEansAndOriginsBatched(eans, origins);
      }
    }

    return baseProducts.map((baseProduct) => {
      const competitorPrices = pricesByOrigin.get(String(baseProduct.ean)) ?? new Map<Origin, number>();
      const offerPrice = baseProduct.offerBooks?.[0]?.priceForOffer ?? null;

      return {
        baseProduct,
        competitorPrices,
        offerPrice
      };
    });
  }
}
