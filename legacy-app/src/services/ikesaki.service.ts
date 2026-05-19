import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { Origin } from '../common/origin.enum';
import { stripHtmlTags } from '../common/strip-html-tags.helper';
import { ProductImageTypeormEntity } from '../database/entities/product-image.entity';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { ProductRepository } from '../database/repositories/product.repository';
import { IkesakiApiGetProductApiResponse } from '../interfaces/ikesaki/get-product.api.interface';
import { ProductStockTypeormEntity } from '../database/entities/product-stock.entity';

@Injectable()
export class IkesakiService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly httpService: HttpService
  ) {}

  public async importProduct(ean: number): Promise<ProductTypeormEntity> {
    const { product, error } = await this.fetchProductByEan(ean);

    if (!product || error) return this.saveEmptyProduct(ean, error);

    return this.saveProduct(ean, product);
  }

  private async fetchProductByEan(ean: number): Promise<{ product?: IkesakiApiGetProductApiResponse; error?: Error }> {
    try {
      const url = `https://www.ikesaki.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`;
      const response = await this.httpService.axiosRef.get<IkesakiApiGetProductApiResponse[]>(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          accept: '*/*',
          'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty'
        },
        timeout: 30000
      });


      if (!response.data.length) return {};
      return { product: response.data[0] };
    } catch (error) {
      console.error(`Error fetching Ikesaki Product with EAN ${ean}:`, error.message);
      return { error };
    }
  }

  private async saveEmptyProduct(ean: number, error?: Error): Promise<ProductTypeormEntity> {
    const productEntity = new ProductTypeormEntity();
    productEntity.ean = ean;
    productEntity.origin = Origin.IKESAKI;
    productEntity.error = error?.message || null;

    return this.productRepository.save(productEntity);
  }

  private async saveProduct(ean: number, apiResponse: IkesakiApiGetProductApiResponse): Promise<ProductTypeormEntity> {
    if (!apiResponse.items.length || !apiResponse.items[0].sellers.length || !apiResponse.items[0].sellers[0].commertialOffer) return;
    const productEntity = new ProductTypeormEntity();

    const existingProduct = await this.productRepository.findByEanAndOrigin(ean, Origin.IKESAKI);
    if (existingProduct) {
      productEntity.stock = existingProduct.stock;
      productEntity.id = existingProduct.id
    };

    productEntity.ean = ean;
    productEntity.name = apiResponse.productName;
    productEntity.origin = Origin.IKESAKI;
    productEntity.price = apiResponse.items[0].sellers[0].commertialOffer.Price;
    productEntity.observation = apiResponse.items[0].sellers[0].commertialOffer.PromotionTeasers[0]?.Name;
    productEntity.brand = apiResponse.brand;
    productEntity.exists = true;
    productEntity.sku = Number(apiResponse.productReferenceCode);
    productEntity.description = stripHtmlTags(apiResponse.description);
    productEntity.image = apiResponse.items[0].images[0].imageUrl;
    productEntity.error = null;

    if (!productEntity.stock) productEntity.stock = new ProductStockTypeormEntity();

    productEntity.stock.hasStock = apiResponse.items[0].sellers[0].commertialOffer.IsAvailable;
    productEntity.stock.error = null;

    await this.saveImages(productEntity, apiResponse, existingProduct);

    return this.productRepository.save(productEntity);
  }

  private async saveImages(productEntity: ProductTypeormEntity, productResponse: IkesakiApiGetProductApiResponse, existingProduct?: ProductTypeormEntity): Promise<void> {
    if (existingProduct?.images?.length) return;

    productEntity.images = productResponse.items[0].images
      .filter((img) => img.imageUrl)
      .map((img) => {
        const imageModel = new ProductImageTypeormEntity();
        imageModel.url = img.imageUrl;
        return imageModel;
      });
  }
}
