import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SYNCHRONIZE_BASE_PRODUCT_METRICS_USE_CASE } from '../common/import.events';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { StatusSettingsRepository } from '../database/repositories/status-settings.repository';
import { StatusSettingsTypeormEntity } from '../database/entities/status-settings.entity';

@Injectable()
export class SynchronizeBaseProductMetricsUseCase {
  private BATCH_SIZE = 1000;

  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly statusSettingsRepository: StatusSettingsRepository
  ) {}

  @OnEvent(SYNCHRONIZE_BASE_PRODUCT_METRICS_USE_CASE)
  public async execute(): Promise<void> {
    console.log('Starting base product metrics calculation');

    try {
      const statusSettings = await this.statusSettingsRepository.findFirst();

      let page = 0;
      let processedCount = 0;

      while (true) {
        console.log(`Processing batch: page ${page}`);
        const [results, total] = await this.baseProductRepository.getProductsCrossedPaginated(page, this.BATCH_SIZE);

        if (!results.length) break;

        for (const { baseProduct, competitorPrices } of results) {
          const { drogalPrice, drogasilPrice } = competitorPrices;
          const cost = baseProduct.cost || 0;
          const priceForSell = baseProduct.price || 0;

          const [activeOfferBook] = baseProduct.offerBooks || [];
          const priceForOffer = activeOfferBook?.priceForOffer || 0;
          const basePrice = priceForOffer || priceForSell;

          // margin = (basePrice - cost) / basePrice * 100
          const margin = basePrice > 0 ? ((basePrice - cost) / basePrice) * 100 : null;

          // averageVariation = (basePrice - avgCompetitorPrice) / avgCompetitorPrice * 100
          const validPriceCount = (drogalPrice > 0 ? 1 : 0) + (drogasilPrice > 0 ? 1 : 0);
          const avgCompetitorPrice = validPriceCount > 0 ? (drogalPrice + drogasilPrice) / validPriceCount : 0;
          const averageVariation = avgCompetitorPrice > 0 ? ((basePrice - avgCompetitorPrice) / avgCompetitorPrice) * 100 : null;

          baseProduct.margin = margin;
          baseProduct.averageVariation = averageVariation;
          baseProduct.status = this.calculateStatus(averageVariation, statusSettings);

          await this.baseProductRepository.save(baseProduct);
          processedCount++;
        }

        console.log(`Processed ${processedCount} of ${total} products...`);

        if ((page + 1) * this.BATCH_SIZE >= total) break;
        page++;
      }

      console.log(`Base product metrics calculation completed. Total processed: ${processedCount}`);
    } catch (error) {
      console.error(`Error during base product metrics calculation: ${error.message}`);
      throw error;
    }
  }

  private calculateStatus(averageVariation: number | null, settings: StatusSettingsTypeormEntity | null): string | null {
    if (!averageVariation) return null;

    // Use settings from database if available, otherwise use default values
    const suspectBelow = settings?.suspectBelow ?? -15;
    const attentionBelow = settings?.attentionBelow ?? 0;
    const attentionAbove = settings?.attentionAbove ?? 20;
    const suspectAbove = settings?.suspectAbove ?? 50;

    if (averageVariation > suspectAbove) return 'SUSPEITA';
    if (averageVariation >= attentionAbove && averageVariation <= suspectAbove) return 'ATENÇÃO';
    if (averageVariation >= attentionBelow && averageVariation < attentionAbove) return 'OK';
    if (averageVariation >= suspectBelow && averageVariation < attentionBelow) return 'ATENÇÃO';

    return 'SUSPEITA';
  }
}
