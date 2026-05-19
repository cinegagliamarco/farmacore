import { Injectable } from '@nestjs/common';
import { Origin } from '../common/origin.enum';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { OpenAIService } from '../services/openai.service';

export interface GenerateDescriptionsResult {
  total: number;
  processed: number;
  skipped: number;
  results: Array<{
    id: number;
    ean: number;
    success: boolean;
    error?: string;
  }>;
}

@Injectable()
export class GenerateBaseProductDescriptionsByIdsUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly openAIService: OpenAIService
  ) {}

  public async execute(baseProductIds: number[]): Promise<GenerateDescriptionsResult> {
    const baseProducts = await this.baseProductRepository.findActiveByIds(baseProductIds);

    const result: GenerateDescriptionsResult = {
      total: baseProductIds.length,
      processed: 0,
      skipped: 0,
      results: []
    };

    const workSize = 10;
    const tasks = [...baseProducts];

    while (tasks.length) {
      const productsToRequest = tasks.splice(0, workSize);

      const promises = productsToRequest.map(async (bProduct) => {
        try {
          const [drogalProduct, drogasilProduct, pagueMenosProduct, ikesakiProduct] = await Promise.all([
            this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.DROGAL),
            this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.DROGASIL),
            this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.PAGUE_MENOS),
            this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.IKESAKI)
          ]);

          const descriptions = [drogalProduct?.description, drogasilProduct?.description, pagueMenosProduct?.description, ikesakiProduct?.description]
            .filter((d): d is string => !!d)
            .slice(0, 2);

          if (!descriptions.length) {
            result.skipped++;
            result.results.push({
              id: bProduct.id,
              ean: bProduct.ean,
              success: false,
              error: 'No source descriptions available'
            });
            return;
          }

          const description = await this.openAIService.generateMergedProductDescription(descriptions);
          await this.baseProductRepository.updateDescription(bProduct.ean, description);

          result.processed++;
          result.results.push({
            id: bProduct.id,
            ean: bProduct.ean,
            success: true
          });
        } catch (error) {
          result.results.push({
            id: bProduct.id,
            ean: bProduct.ean,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      });

      await Promise.all(promises);
    }

    // Handle IDs that were not found
    const foundIds = new Set(baseProducts.map((bp) => bp.id));
    for (const id of baseProductIds) {
      if (!foundIds.has(id)) {
        result.skipped++;
        result.results.push({
          id,
          ean: 0,
          success: false,
          error: 'Base product not found'
        });
      }
    }

    return result;
  }
}

