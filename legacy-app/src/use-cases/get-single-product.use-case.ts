import { Injectable } from '@nestjs/common';
import { AVAILABLE_ORIGINS } from '../common/constants/available-origins.constant';
import { Origin } from '../common/origin.enum';
import { BaseProductImageTypeormEntity } from '../database/entities/base-product-image.entity';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { BucketService } from '../services/bucket.service';
import { DrogalService } from '../services/drogal.service';
import { DrogasilService } from '../services/drogasil.service';
import { IkesakiService } from '../services/ikesaki.service';
import { MichelassiService } from '../services/michelassi.service';
import { OpenAIService } from '../services/openai.service';
import { PagueMenosService } from '../services/pague-menos.service';
import { BaseProductOrigin } from '../common/base-product-origin.enum';

@Injectable()
export class GetSingleProductUseCase {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly baseProductRepository: BaseProductRepository,
    private readonly drogasilService: DrogasilService,
    private readonly drogalService: DrogalService,
    private readonly openAIService: OpenAIService,
    private readonly pagueMenosService: PagueMenosService,
    private readonly ikesakiService: IkesakiService,
    private readonly michelassiService: MichelassiService,
    private readonly bucketService: BucketService
  ) {}

  public async execute(ean: number, withDescription = false, withImages = false): Promise<Record<string, unknown>> {
    let baseProduct = await this.baseProductRepository.findOne(ean);
    if (!baseProduct) {
      baseProduct = new BaseProductTypeormEntity();
      baseProduct.ean = ean;
      baseProduct.origin = BaseProductOrigin.CSV;
      baseProduct.images = [];
    }

    for (const element of AVAILABLE_ORIGINS) await this.productRepository.setProductToOutdated(ean, element);

    const [drogalProduct, drogasilProduct, pagueMenosProduct, ikesakiProduct, michelassiProduct] = await Promise.all([
      this.getDrogalProduct(ean),
      this.getDrogasilProduct(ean),
      this.getPagueMenosProduct(ean),
      this.getIkesakiProduct(ean),
      this.getMichelassiProduct(ean)
    ]);

    const result = this.mergeProducts(baseProduct, drogalProduct, drogasilProduct, pagueMenosProduct, ikesakiProduct, michelassiProduct);

    if (withDescription) {
      const descriptions = [
        drogalProduct.description,
        drogasilProduct.description,
        pagueMenosProduct.description,
        ikesakiProduct.description,
        michelassiProduct.description
      ]
        .filter((d) => !!d)
        .slice(0, 2); // Only two is enough for now
      const description = await this.openAIService.generateMergedProductDescription(descriptions);
      result.description = description;
      baseProduct.description = description;
    }

    if (withImages) {
      const sortedArray = [drogalProduct, drogasilProduct, pagueMenosProduct, ikesakiProduct, michelassiProduct]
        .filter((p) => p?.images?.length)
        .sort((a, b) => b.images.length - a.images.length);
      const [highestImageCountProduct] = sortedArray;
      const images = highestImageCountProduct.images;

      let index = 0;
      for (const img of images) {
        const baseImageModel = new BaseProductImageTypeormEntity();
        const imageId = `${ean}-${index}`;
        const url = await this.bucketService.uploadImageFromUrl(img.url, imageId);
        baseImageModel.url = url;
        baseImageModel.baseProduct = baseProduct;
        baseProduct.images.push(baseImageModel);
        index++;
      }

      result.images = baseProduct.images.map((img) => img.url);
    }

    await this.baseProductRepository.save(baseProduct);

    return result;
  }

  private async getDrogalProduct(ean: number): Promise<ProductTypeormEntity> {
    await this.drogalService.importProduct(ean);
    const product = await this.productRepository.findByEanAndOrigin(ean, Origin.DROGAL);
    const [productWithStock] = await this.drogalService.fetchProductsStock([product]);
    return productWithStock;
  }

  private async getDrogasilProduct(ean: number): Promise<ProductTypeormEntity> {
    await this.drogasilService.importProduct(ean);
    const product = await this.productRepository.findByEanAndOrigin(ean, Origin.DROGASIL);
    const [productWithStock] = await this.drogasilService.fetchProductsStock([product]);
    return productWithStock;
  }

  private async getPagueMenosProduct(ean: number): Promise<ProductTypeormEntity> {
    return this.pagueMenosService.importProduct(ean);
  }

  private async getIkesakiProduct(ean: number): Promise<ProductTypeormEntity> {
    return this.ikesakiService.importProduct(ean);
  }

  private async getMichelassiProduct(ean: number): Promise<ProductTypeormEntity> {
    return this.michelassiService.importProduct(ean);
  }

  private mergeProducts(
    baseProduct: BaseProductTypeormEntity,
    drogalProduct: ProductTypeormEntity,
    drogasilProduct: ProductTypeormEntity,
    pagueMenosProduct: ProductTypeormEntity,
    ikesakiProduct: ProductTypeormEntity,
    michelassiProduct: ProductTypeormEntity
  ): Record<string, unknown> {
    return {
      base_product_weight: baseProduct.weight ?? null,
      base_product_cubic_weight: baseProduct.cubicWeight ?? null,
      base_product_height: baseProduct.height ?? null,
      base_product_length: baseProduct.length ?? null,
      base_product_width: baseProduct.width ?? null,

      drogal_name: drogalProduct.name ?? '',
      drogasil_name: drogasilProduct.name ?? '',
      pague_menos_name: pagueMenosProduct.name ?? '',
      ikesaki_name: ikesakiProduct.name ?? '',
      michelassi_name: michelassiProduct.name ?? '',

      drogal_price: (drogalProduct.price ?? '').toString().replaceAll('.', ','),
      drogasil_price: (drogasilProduct.price ?? '').toString().replaceAll('.', ','),
      pague_menos_price: (pagueMenosProduct.price ?? '').toString().replaceAll('.', ','),
      ikesaki_price: (ikesakiProduct.price ?? '').toString().replaceAll('.', ','),
      michelassi_price: (michelassiProduct.price ?? '').toString().replaceAll('.', ','),

      drogal_is_pbm: drogalProduct.isPbm ?? false,
      drogal_van: drogalProduct.van ?? '',
      drogasil_is_pbm: drogasilProduct.isPbm ?? false,

      drogal_observation: drogalProduct.observation ?? '',
      drogasil_observation: drogasilProduct.observation ?? '',
      pague_menos_observation: pagueMenosProduct.observation ?? '',
      ikesaki_observation: ikesakiProduct.observation ?? '',
      michelassi_observation: michelassiProduct.observation ?? '',

      drogal_subsidiary_one_stock: drogalProduct.stock?.subsidiaryOneStock ?? 0,
      drogasil_subsidiary_one_stock: drogasilProduct.stock?.subsidiaryOneStock ?? 0,
      michelassi_subsidiary_one_stock: michelassiProduct.stock?.subsidiaryOneStock ?? 0,

      drogal_subsidiary_two_stock: drogalProduct.stock?.subsidiaryTwoStock ?? 0,

      drogasil_category: drogasilProduct.category ?? '',
      drogasil_weight: drogasilProduct.weight ?? 0,

      drogal_cubicWeight: drogalProduct.cubicWeight ?? 0,
      drogal_height: drogalProduct.height ?? 0,
      drogal_length: drogalProduct.length ?? 0,
      drogal_weight: drogalProduct.weight ?? 0,
      drogal_width: drogalProduct.width ?? 0,

      drogasil_main_image: drogasilProduct.image || '',
      drogal_main_image: drogalProduct.image || '',
      pague_menos_main_image: pagueMenosProduct.image || '',
      ikesaki_main_image: ikesakiProduct.image || '',
      michelassi_main_image: michelassiProduct.image || '',

      drogasil_images: drogasilProduct.images?.map((img) => img.url) || [],
      drogal_images: drogalProduct.images?.map((img) => img.url) || [],
      pague_menos_images: pagueMenosProduct.images?.map((img) => img.url) || [],
      ikesaki_images: ikesakiProduct.images?.map((img) => img.url) || [],
      michelassi_images: michelassiProduct.images?.map((img) => img.url) || [],

      drogal_description: drogalProduct.description ?? '',
      drogasil_description: drogasilProduct.description ?? '',
      pague_menos_description: pagueMenosProduct.description ?? '',
      ikesaki_description: ikesakiProduct.description ?? '',
      michelassi_description: michelassiProduct.description ?? ''
    };
  }
}
