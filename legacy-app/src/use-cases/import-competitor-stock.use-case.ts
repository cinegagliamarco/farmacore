import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { IMPORT_DROGAL_STOCK_USE_CASE, IMPORT_DROGASIL_STOCK_USE_CASE } from '../common/import.events';
import { Origin } from '../common/origin.enum';
import { wait } from '../common/wait-for.helper';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { ProductRepository } from '../database/repositories/product.repository';
import { DrogalService } from '../services/drogal.service';
import { DrogasilService } from '../services/drogasil.service';

interface StockService {
  fetchProductsStock(products: ProductTypeormEntity[]): Promise<ProductTypeormEntity[]>;
}

interface StockConfig {
  batchSize: number;
  delayMs: number;
}

const STOCK_CONFIGS: Partial<Record<Origin, StockConfig>> = {
  [Origin.DROGAL]: { batchSize: 50, delayMs: 5000 },
  [Origin.DROGASIL]: { batchSize: 30, delayMs: 5000 }
};

@Injectable()
export class ImportCompetitorStockUseCase {
  private readonly serviceMap: Partial<Record<Origin, StockService>>;

  constructor(
    private readonly productRepository: ProductRepository,
    drogalService: DrogalService,
    drogasilService: DrogasilService
  ) {
    this.serviceMap = {
      [Origin.DROGAL]: drogalService,
      [Origin.DROGASIL]: drogasilService
    };
  }

  @OnEvent(IMPORT_DROGAL_STOCK_USE_CASE)
  public async importDrogalStock(): Promise<void> {
    return this.execute(Origin.DROGAL);
  }

  @OnEvent(IMPORT_DROGASIL_STOCK_USE_CASE)
  public async importDrogasilStock(): Promise<void> {
    return this.execute(Origin.DROGASIL);
  }

  private async execute(origin: Origin): Promise<void> {
    const config = STOCK_CONFIGS[origin];
    const service = this.serviceMap[origin];

    const products = await this.productRepository.findWithoutStockByOrigin(origin);
    const tasks = [...products];

    while (tasks.length) {
      console.log(`[${origin}] Remaining ${tasks.length} products stock ${new Date().toISOString()}`);
      const batch = tasks.splice(0, config.batchSize);
      await service.fetchProductsStock(batch);
      await wait(config.delayMs);
    }
  }
}
