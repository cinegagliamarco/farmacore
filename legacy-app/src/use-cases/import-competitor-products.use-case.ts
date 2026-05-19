import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  IMPORT_PRODUCTS_DROGAL_USE_CASE,
  IMPORT_PRODUCTS_DROGASIL_USE_CASE,
  IMPORT_PRODUCTS_IKESAKI_USE_CASE,
  IMPORT_PRODUCTS_MICHELASSI_USE_CASE,
  IMPORT_PRODUCTS_PAGUE_MENOS_USE_CASE
} from '../common/import.events';
import { Origin } from '../common/origin.enum';
import { wait } from '../common/wait-for.helper';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { DrogalService } from '../services/drogal.service';
import { DrogasilService } from '../services/drogasil.service';
import { IkesakiService } from '../services/ikesaki.service';
import { MichelassiService } from '../services/michelassi.service';
import { PagueMenosService } from '../services/pague-menos.service';

interface ImportService {
  importProduct(ean: number): Promise<ProductTypeormEntity>;
}

interface OriginConfig {
  batchSize: number;
  delayMs: number;
  gcInterval: number;
}

const ORIGIN_CONFIGS: Record<Origin, OriginConfig> = {
  [Origin.DROGAL]: { batchSize: 20, delayMs: 200, gcInterval: 30 },
  [Origin.DROGASIL]: { batchSize: 10, delayMs: 100, gcInterval: 25 },
  [Origin.PAGUE_MENOS]: { batchSize: 20, delayMs: 200, gcInterval: 30 },
  [Origin.IKESAKI]: { batchSize: 10, delayMs: 200, gcInterval: 30 },
  [Origin.MICHELASSI]: { batchSize: 1, delayMs: 350, gcInterval: 50 }
};

@Injectable()
export class ImportCompetitorProductsUseCase {
  private readonly serviceMap: Record<Origin, ImportService>;

  constructor(
    private readonly productRepository: ProductRepository,
    private readonly baseProductRepository: BaseProductRepository,
    drogalService: DrogalService,
    drogasilService: DrogasilService,
    pagueMenosService: PagueMenosService,
    ikesakiService: IkesakiService,
    michelassiService: MichelassiService
  ) {
    this.serviceMap = {
      [Origin.DROGAL]: drogalService,
      [Origin.DROGASIL]: drogasilService,
      [Origin.PAGUE_MENOS]: pagueMenosService,
      [Origin.IKESAKI]: ikesakiService,
      [Origin.MICHELASSI]: michelassiService
    };
  }

  @OnEvent(IMPORT_PRODUCTS_DROGAL_USE_CASE)
  public async importDrogal({ force }: { force: boolean } = { force: false }): Promise<void> {
    return this.execute(Origin.DROGAL, force);
  }

  @OnEvent(IMPORT_PRODUCTS_DROGASIL_USE_CASE)
  public async importDrogasil({ force }: { force: boolean } = { force: false }): Promise<void> {
    return this.execute(Origin.DROGASIL, force);
  }

  @OnEvent(IMPORT_PRODUCTS_PAGUE_MENOS_USE_CASE)
  public async importPagueMenos(): Promise<void> {
    return this.execute(Origin.PAGUE_MENOS);
  }

  @OnEvent(IMPORT_PRODUCTS_IKESAKI_USE_CASE)
  public async importIkesaki(): Promise<void> {
    return this.execute(Origin.IKESAKI);
  }

  @OnEvent(IMPORT_PRODUCTS_MICHELASSI_USE_CASE)
  public async importMichelassi(): Promise<void> {
    return this.execute(Origin.MICHELASSI);
  }

  private async execute(origin: Origin, force = false): Promise<void> {
    const config = ORIGIN_CONFIGS[origin];
    const service = this.serviceMap[origin];

    const [existingProducts, baseProducts] = await Promise.all([
      force ? Promise.resolve([]) : this.productRepository.findUpdatedByOrigin(origin),
      this.baseProductRepository.findAllEANs()
    ]);

    const existingEans = new Set(existingProducts.map(({ ean }) => ean));
    const pendingProducts = baseProducts.filter(({ ean }) => !existingEans.has(ean));

    console.log(`[${origin}] Total base products: ${baseProducts.length}, pending: ${pendingProducts.length}`);

    const tasks = [...pendingProducts];
    let processedCount = 0;

    while (tasks.length) {
      console.log(`[${origin}] Remaining ${tasks.length} products ${new Date().toISOString()}`);
      const batch = tasks.splice(0, config.batchSize);

      const promises = batch.map(async ({ ean }) => {
        try {
          await service.importProduct(ean);
          processedCount++;

          if (processedCount % config.gcInterval === 0 && global.gc) global.gc();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[${origin}] Error importing product EAN ${ean}: ${errorMessage}`);
          await this.productRepository.saveProductError(ean, origin, errorMessage);
        }
      });

      await Promise.all(promises);

      if (tasks.length) await wait(config.delayMs);
    }
  }
}
