import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { Origin } from '../common/origin.enum';
import { stripHtmlTags } from '../common/strip-html-tags.helper';
import { ProductImageTypeormEntity } from '../database/entities/product-image.entity';
import { ProductStockTypeormEntity } from '../database/entities/product-stock.entity';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { ProductRepository } from '../database/repositories/product.repository';
import { DrogalApiGetProductApiResponse, DrogalCustomData } from '../interfaces/drogal/get-product.api.interface';
import { DrogalStockApiResponse } from '../interfaces/drogal/stock.api.interface';
import { DrogalVariationsApiResponse, DrogalVariationsMeasures } from '../interfaces/drogal/variations.api.interface';

@Injectable()
export class DrogalService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly httpService: HttpService
  ) {}

  public async importProduct(ean: number): Promise<ProductTypeormEntity> {
    const { product, error } = await this.fetchProductByEan(ean);

    if (!product || error) return this.saveEmptyProduct(ean, error);

    return this.saveProduct(ean, product);
  }

  public async fetchProductsStock(products: ProductTypeormEntity[]): Promise<ProductTypeormEntity[]> {
    const url = `https://www.drogal.com.br/_v/drogalCheckout`;
    const items = products.map(({ sku }) => ({
      productRefId: sku,
      quantity: '1'
    }));
    const payload = {
      type: 'getPickupPointsByItems',
      params: { items }
    };

    const response = await this.httpService.axiosRef
      .post<DrogalStockApiResponse>(url, payload, {
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
      })
      .then((response) => {
        if (!response.data?.body?.pickupPointItems?.length) return { products: [], error: null };

        return { products: response.data.body.pickupPointItems };
      })
      .catch((error) => {
        console.error(`Error fetching Drogal product stock: ${JSON.stringify(items)}`, error);
        return { products: [], error: error.message };
      });

    const subsidiaryOne = response.products?.length ? response.products.find(({ CodigoFilial }) => CodigoFilial === 113) : undefined;
    const subsidiaryTwo = response.products?.length ? response.products.find(({ CodigoFilial }) => CodigoFilial === 310) : undefined;

    for (const product of products) {
      const stockSubsidiaryOne = subsidiaryOne?.CartDetail?.find(({ productRefId }) => productRefId === product.sku);
      const stockSubsidiaryTwo = subsidiaryTwo?.CartDetail?.find(({ productRefId }) => productRefId === product.sku);

      if (!product.stock) product.stock = new ProductStockTypeormEntity();

      product.stock.hasStock = Boolean(stockSubsidiaryOne?.avaliable || stockSubsidiaryTwo?.avaliable);

      product.stock.subsidiaryOneStock = stockSubsidiaryOne?.quantityAvaliable ?? 0;
      product.stock.subsidiaryTwoStock = stockSubsidiaryTwo?.quantityAvaliable ?? 0;

      product.stock.error = response.error || null;
    }

    return Promise.all(products.map((product) => this.productRepository.save(product)));
  }

  private async fetchProductByEan(ean: number): Promise<{ product?: DrogalApiGetProductApiResponse; error?: Error }> {
    try {
      const url = `https://www.drogal.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`;
      const response = await this.httpService.axiosRef.get<DrogalApiGetProductApiResponse[]>(url, {
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
      console.error(`Error fetching Drogal Product with EAN ${ean}:`, error.message);
      return { error };
    }
  }

  private async saveEmptyProduct(ean: number, error?: Error): Promise<ProductTypeormEntity> {
    const productEntity = new ProductTypeormEntity();
    productEntity.ean = ean;
    productEntity.origin = Origin.DROGAL;
    productEntity.error = error?.message || null;

    return this.productRepository.save(productEntity);
  }

  private async saveProduct(ean: number, product: DrogalApiGetProductApiResponse): Promise<ProductTypeormEntity> {
    if (!product.items.length || !product.items[0].sellers.length || !product.items[0].sellers[0].commertialOffer) return;

    const productEntity = new ProductTypeormEntity();
    productEntity.ean = ean;
    productEntity.name = product.productName;
    productEntity.origin = Origin.DROGAL;
    productEntity.price = product.items[0].sellers[0].commertialOffer.Price;
    productEntity.observation = product.items[0].sellers[0].commertialOffer.PromotionTeasers[0]?.Name;
    productEntity.brand = product.brand;
    productEntity.exists = true;
    productEntity.sku = Number(product.productReferenceCode);
    productEntity.description = stripHtmlTags(product.description);
    productEntity.image = product.items[0].images[0].imageUrl;
    productEntity.error = null;

    const { isPbm, pbmPrice, van } = this.detectDrogalPbm(product);
    productEntity.isPbm = isPbm;
    productEntity.van = van;
    if (isPbm && pbmPrice > 0) {
      productEntity.price = pbmPrice;
    }

    const measures = await this.fetchProductMeasures(ean, product.productId);
    if (measures) {
      productEntity.cubicWeight = measures.cubicweight;
      productEntity.height = measures.height;
      productEntity.length = measures.length;
      productEntity.weight = measures.weight;
      productEntity.width = measures.width;
    }

    await this.saveImages(ean, productEntity, product);

    return this.productRepository.save(productEntity);
  }

  private detectDrogalPbm(product: DrogalApiGetProductApiResponse): { isPbm: boolean; pbmPrice: number; van: string | null } {
    let isPbm = false;
    let pbmPrice = 0;
    const van = product.VAN?.length ? product.VAN[0] : null;

    if (product.CustomData?.length) {
      for (const rawData of product.CustomData) {
        try {
          const parsed: DrogalCustomData = JSON.parse(rawData);
          if (parsed.pbmPrice > 0) {
            isPbm = true;
            pbmPrice = parsed.pbmPrice / 100;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!isPbm && product.PBM?.length) {
      isPbm = true;
    }

    return { isPbm, pbmPrice, van };
  }

  private async fetchProductMeasures(ean: number, productId: string): Promise<DrogalVariationsMeasures | undefined> {
    try {
      const url = `https://www.drogal.com.br/api/catalog_system/pub/products/variations/${productId}`;
      const response = await this.httpService.axiosRef.get<DrogalVariationsApiResponse>(url, {
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

      if (!response.data?.skus?.length) return undefined;

      return response.data.skus[0].measures;
    } catch (error) {
      console.error(`Error fetching Drogal product variations for SKU ${ean}:`, error.message);
      return undefined;
    }
  }

  private async saveImages(ean: number, productEntity: ProductTypeormEntity, productResponse: DrogalApiGetProductApiResponse): Promise<void> {
    const existingProduct = await this.productRepository.findByEanAndOrigin(ean, Origin.DROGAL);
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
