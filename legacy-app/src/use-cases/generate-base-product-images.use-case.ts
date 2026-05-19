import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GENERATE_BASE_PRODUCT_IMAGES_USE_CASE } from '../common/import.events';
import { wait } from '../common/wait-for.helper';
import { BaseProductImageTypeormEntity } from '../database/entities/base-product-image.entity';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductImageRepository } from '../database/repositories/product-image.repository';
import { BucketService } from '../services/bucket.service';

/** Small batches keep heap stable on low-memory dynos (e.g. 512MB). */
const IMAGE_GENERATION_BATCH_SIZE = 50;

@Injectable()
export class GenerateBaseProductImagesUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productImageRepository: ProductImageRepository,
    private readonly bucketService: BucketService
  ) {}

  @OnEvent(GENERATE_BASE_PRODUCT_IMAGES_USE_CASE)
  public async execute(): Promise<void> {
    console.log('🚀 Starting process GENERATE_BASE_PRODUCT_IMAGES_USE_CASE!');

    const totalProducts = await this.baseProductRepository.countWithoutImages();
    console.log(`📊 Total products without images: ${totalProducts}`);

    if (!totalProducts) return;

    let index = 0;
    let successCount = 0;
    let errorCount = 0;
    let lastId = 0;

    while (true) {
      const batch = await this.baseProductRepository.findBatchWithoutImagesAfter(lastId, IMAGE_GENERATION_BATCH_SIZE);
      if (batch.length === 0) {
        break;
      }

      lastId = Math.max(...batch.map((p) => p.id));

      for (const baseProduct of batch) {
        index++;
        console.log(`Processing product ${index}/${totalProducts} (EAN: ${baseProduct.ean}) ${new Date().toISOString()}`);

        try {
          const savedImagesCount = await this.saveBaseProductImages(baseProduct);
          if (savedImagesCount > 0) {
            console.log(`✅ Saved ${savedImagesCount} images for EAN ${baseProduct.ean}`);
            successCount++;
          } else {
            console.log(`⚠️  No images saved for EAN ${baseProduct.ean}`);
            await this.baseProductRepository.setSkipImageGeneration(baseProduct.id, true);
          }
        } catch (error) {
          console.error(`❌ Error generating base product images with EAN ${baseProduct.ean}:`, error.message);
          errorCount++;
        }
      }

      if (global.gc) {
        global.gc();
        await wait(50);
      }
    }

    if (global.gc) {
      global.gc();
      await wait(200);
    }

    console.log(`✅ Process complete! Success: ${successCount}, Errors: ${errorCount}, Total: ${totalProducts}`);
  }

  public async saveBaseProductImages(baseProduct: BaseProductTypeormEntity): Promise<number> {
    const images = await this.productImageRepository.findProductImagesByEan(baseProduct.ean);

    if (!images || images.length === 0) {
      console.log(`⚠️  No product images found in database for EAN ${baseProduct.ean}`);
      return 0;
    }

    console.log(`Found ${images.length} product images for EAN ${baseProduct.ean}`);

    const imageModels: BaseProductImageTypeormEntity[] = [];
    let index = 0;

    for (const img of images) {
      try {
        const baseImageModel = new BaseProductImageTypeormEntity();
        const imageId = `${baseProduct.ean}-${index}`;
        const url = await this.bucketService.uploadImageFromUrl(img.url, imageId);

        if (!url) {
          console.log(`⚠️  Failed to upload image ${index} for EAN ${baseProduct.ean} from ${img.url}`);
          index++;
          continue;
        }

        baseImageModel.url = url;
        baseImageModel.baseProduct = baseProduct;
        imageModels.push(baseImageModel);
        index++;
      } catch (error) {
        console.error(`Failed to process image ${index} for EAN ${baseProduct.ean}:`, error.message);
        index++;
      }
    }

    if (imageModels.length === 0) {
      console.log(`⚠️  No images successfully uploaded for EAN ${baseProduct.ean}`);
      return 0;
    }

    // Assign all images at once
    baseProduct.images = imageModels;
    await this.baseProductRepository.save(baseProduct);

    const savedCount = imageModels.length;

    // Clear references to help GC
    imageModels.length = 0;
    images.length = 0;
    baseProduct.images = [];

    return savedCount;
  }
}
