import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GENERATE_BASE_PRODUCT_DESCRIPTION_USE_CASE } from '../common/import.events';
import { Origin } from '../common/origin.enum';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { OpenAIService } from '../services/openai.service';

@Injectable()
export class GenerateBaseProductDescriptionUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly openAIService: OpenAIService
  ) {}

  @OnEvent(GENERATE_BASE_PRODUCT_DESCRIPTION_USE_CASE)
  public async execute() {
    const baseProducts = await this.baseProductRepository.findAllWithoutDescription();

    const workSize = 10;
    const tasks = [...baseProducts];
    while (tasks.length) {
      console.log(`Remaining ${tasks.length} Base Products ${new Date().toISOString()}`);
      const productsToRequest = tasks.splice(0, workSize);

      const promises = productsToRequest.map(async (bProduct) => {
        const [drogalProduct, drogasilProduct, pagueMenosProduct, ikesakiProduct] = await Promise.all([
          this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.DROGAL),
          this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.DROGASIL),
          this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.PAGUE_MENOS),
          this.productRepository.findByEanAndOrigin(bProduct.ean, Origin.IKESAKI)
        ]);
        const descriptions = [drogalProduct?.description, drogasilProduct?.description, pagueMenosProduct?.description, ikesakiProduct?.description]
          .filter((d) => !!d)
          .slice(0, 2); // Only two is enough for now
        if (!descriptions.length) return;

        const description = await this.openAIService.generateMergedProductDescription(descriptions);

        return this.baseProductRepository.updateDescription(bProduct.ean, description);
      });

      await Promise.all(promises);
    }
  }
}
