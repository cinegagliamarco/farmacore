import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GenerateBaseProductPropertiesUseCase } from '../use-cases/generate-base-product-properties.use-case';
import { ImportCompetitorProductsUseCase } from '../use-cases/import-competitor-products.use-case';
import { ImportCompetitorStockUseCase } from '../use-cases/import-competitor-stock.use-case';
import { SynchronizeBaseProductMetricsUseCase } from '../use-cases/synchronize-base-product-metrics.use-case';
import { SynchronizeBaseProductStockUseCase } from '../use-cases/synchronize-base-product-stock.use-case';
import { SynchronizeBaseProductUseCase } from '../use-cases/synchronize-base-product.use-case';
import { SynchronizeOfferBooksInfoUseCase } from '../use-cases/synchronize-offer-books-info.use-case';
import { UpdateActiveIngredientMatUseCase } from '../use-cases/update-active-ingredient-mat.use-case';

/**
 * Single daily pipeline that runs every step in strict dependency order.
 * Each step awaits completion before the next one starts.
 *
 * Execution order and dependencies:
 * ┌─────┬──────────────────────────────────┬──────────────────────────────────────────────────────────────┐
 * │  #  │ Step                             │ Depends on                                                   │
 * ├─────┼──────────────────────────────────┼──────────────────────────────────────────────────────────────┤
 * │  1  │ synchronizeBaseProduct           │ (none) — ERP → base_product + offer_book                    │
 * │  2  │ synchronizeBaseProductStock      │ #1 — reads base_product by EAN                              │
 * │  3  │ synchronizeOfferBooksInfo        │ (none) — integration DB → offer_book_info                   │
 * │  4  │ importProducts                   │ #1 — reads base_product EANs, writes product                │
 * │  5  │ importStocks                     │ #4 — reads product rows by origin                           │
 * │  6  │ calculateBaseProductMetrics      │ #1 + #4 — joins product (competitor prices) + offerBooks     │
 * │  7  │ updateBaseProductProperties      │ #4 — reads product (Drogasil/Drogal) for supplier/weight    │
 * │  8  │ updateActiveIngredientMat        │ #1 — reads base_product                                     │
 * └─────┴──────────────────────────────────┴──────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class DailyRoutinesCron {
  constructor(
    private readonly synchronizeBaseProductUseCase: SynchronizeBaseProductUseCase,
    private readonly synchronizeBaseProductStockUseCase: SynchronizeBaseProductStockUseCase,
    private readonly synchronizeOfferBooksInfoUseCase: SynchronizeOfferBooksInfoUseCase,
    private readonly importCompetitorProductsUseCase: ImportCompetitorProductsUseCase,
    private readonly importCompetitorStockUseCase: ImportCompetitorStockUseCase,
    private readonly calculateBaseProductMetricsUseCase: SynchronizeBaseProductMetricsUseCase,
    private readonly generateBaseProductPropertiesUseCase: GenerateBaseProductPropertiesUseCase,
    private readonly updateActiveIngredientMatUseCase: UpdateActiveIngredientMatUseCase
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  public async execute(): Promise<void> {
    const started = Date.now();
    console.log('Daily pipeline started', new Date().toISOString());

    try {
      console.log('[1/8] synchronizeBaseProduct', new Date().toISOString());
      await this.synchronizeBaseProductUseCase.execute();

      console.log('[2/8] synchronizeBaseProductStock', new Date().toISOString());
      await this.synchronizeBaseProductStockUseCase.execute();

      console.log('[3/8] synchronizeOfferBooksInfo', new Date().toISOString());
      await this.synchronizeOfferBooksInfoUseCase.execute();

      console.log('[4/8] importProducts', new Date().toISOString());
      await this.importCompetitorProductsUseCase.importMichelassi();
      await this.importCompetitorProductsUseCase.importDrogal({ force: false });
      await this.importCompetitorProductsUseCase.importDrogasil({ force: false });

      console.log('[5/8] importStocks', new Date().toISOString());
      await this.importCompetitorStockUseCase.importDrogalStock();
      await this.importCompetitorStockUseCase.importDrogasilStock();

      console.log('[6/8] calculateBaseProductMetrics', new Date().toISOString());
      await this.calculateBaseProductMetricsUseCase.execute();

      console.log('[7/8] updateBaseProductProperties', new Date().toISOString());
      await this.generateBaseProductPropertiesUseCase.execute();

      console.log('[8/8] updateActiveIngredientMat', new Date().toISOString());
      await this.updateActiveIngredientMatUseCase.execute();

      console.log(`Daily pipeline finished in ${((Date.now() - started) / 60_000).toFixed(1)} min`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Daily pipeline failed at ${((Date.now() - started) / 60_000).toFixed(1)} min: ${message}`);
    }
  }
}
