import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosResponse } from 'axios';
import { ZIPCODE } from '../common/constants/zipcode.constant';
import { Origin } from '../common/origin.enum';
import { stripHtmlTags } from '../common/strip-html-tags.helper';
import { ProductImageTypeormEntity } from '../database/entities/product-image.entity';
import { ProductStockTypeormEntity } from '../database/entities/product-stock.entity';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { ProductRepository } from '../database/repositories/product.repository';
import { DrogasilGetProductApiResponse } from '../interfaces/drogasil/get-product.api.interface';
import { GetStockApiResponse } from '../interfaces/drogasil/get-stock.api.interface';

@Injectable()
export class DrogasilService {
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
    const url = 'https://www.drogasil.com.br/api/next/cesta-checkout/graphql';

    const headers = {
      accept: '*/*',
      'accept-language': 'pt-BR,pt;q=0.9',
      'content-type': 'application/json',
      origin: 'https://www.drogasil.com.br',
      referer: 'https://www.drogasil.com.br/checkout/cart',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    };

    const payload = {
      query: `query GET_STOCK($zipcode: String!, $products: [StockNearbyBtZipCodeTypeInput!]!, $logotype: String!, $maxQuantityBranchSearch: String) {
      getNearbyStockByZipCode(
        products: $products
        zipcode: $zipcode
        logotype: $logotype
        maxQuantityBranchSearch: $maxQuantityBranchSearch
      ) {
        branch {
          id
          businessName
          flag24hours
          distanceKMFromSearch
          address {
            district
            addressLocal
            addressNumber
            city
            sgState
          }
          branchService {
            hourOpenNormaly
            hourEndNormaly
          }
        }
        stocks {
          sku
          quantity
        }
      }
    }`,
      variables: {
        zipcode: ZIPCODE,
        products: products.map((product) => ({ sku: product.sku.toString() })),
        logotype: 'RD',
        maxQuantityBranchSearch: '1'
      }
    };

    const { stockData, error } = await this.httpService.axiosRef
      .post<GetStockApiResponse>(url, payload, { headers, timeout: 30000 })
      .then((res) => {
        const stockData = {} as Record<string, number>;
        if (!res.data?.data || res.data?.errors) return { stockData, error: null };

        const { getNearbyStockByZipCode } = res.data?.data;
        if (!getNearbyStockByZipCode || !getNearbyStockByZipCode.length) return { stockData, error: null };

        for (const stock of getNearbyStockByZipCode[0].stocks) {
          stockData[stock.sku] = stock.quantity;
        }

        return { stockData, error: null };
      })
      .catch((error) => {
        console.error('Error fetching Drogasil product stock:', error);
        return { stockData: {} as Record<string, number>, error: error.message };
      });

    for (const product of products) {
      if (!product.stock) product.stock = new ProductStockTypeormEntity();

      const locationWithStock = stockData[product.sku];

      const quantity = locationWithStock ?? 0;

      product.stock.hasStock = quantity > 0;
      product.stock.subsidiaryOneStock = quantity;
      product.stock.error = error || null;
    }

    return Promise.all(products.map((product) => this.productRepository.save(product)));
  }

  /**
   * Memory-optimized HTML parsing with streaming and early termination
   * @param url The URL to fetch
   * @param pattern Regex pattern to search for in the HTML stream
   * @param options Configuration options
   * @returns Promise that resolves with the first match or null
   */
  private async streamParseHtml(
    url: string,
    pattern: RegExp,
    options: {
      timeout?: number;
      maxContentLength?: number;
      maxBufferSize?: number;
      headers?: Record<string, string>;
    } = {}
  ): Promise<string | null> {
    const {
      timeout = 30000,
      maxContentLength = 5 * 1024 * 1024, // Reduced from 10MB to 5MB
      maxBufferSize = 1 * 1024 * 1024, // Reduced from 2MB to 1MB
      headers = {}
    } = options;

    try {
      const response: AxiosResponse = await this.httpService.axiosRef.get(url, {
        responseType: 'stream',
        timeout,
        maxContentLength,
        headers,
      });

      return new Promise((resolve, reject) => {
        let buffer = '';
        let foundMatch: string | null = null;
        let totalBytes = 0;

        const processChunk = (chunk: Buffer) => {
          if (foundMatch) return;

          totalBytes += chunk.length;

          if (totalBytes > maxContentLength) {
            response.data.destroy();
            resolve(null);
            return;
          }

          buffer += chunk.toString();

          const match = buffer.match(pattern);
          if (match) {
            foundMatch = match[1] || match[0];
            response.data.destroy();
            resolve(foundMatch);
            return;
          }

          // More aggressive buffer cleanup
          if (buffer.length > maxBufferSize) {
            buffer = buffer.slice(-50 * 1024); // Keep only last 50KB instead of 100KB
          }
        };

        response.data.on('data', processChunk);
        response.data.on('end', () => resolve(null));
        response.data.on('error', reject);

        setTimeout(() => {
          if (!foundMatch) {
            response.data.destroy();
            resolve(null);
          }
        }, timeout - 5000);
      });
    } catch (error) {
      console.error(`Error streaming HTML from ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Memory-efficient product SKU fetching with streaming parsing
   *
   * Key optimizations:
   * 1. Early termination: Stops reading stream as soon as SKU is found
   * 2. Buffer management: Limits buffer size and removes processed content
   * 3. Memory limits: Enforces total response size and buffer size limits
   * 4. Timeout handling: Prevents hanging requests
   * 5. Error resilience: Graceful handling of stream errors
   *
   * Alternative approaches (if needed):
   * - Use a streaming HTML parser like 'htmlparser2' for more complex parsing
   * - Implement chunk-based regex matching for even lower memory usage
   * - Use worker threads for parallel processing of multiple requests
   */
  private async fetchProductByEan(ean: number): Promise<{ product?: DrogasilGetProductApiResponse; error?: Error }> {
    const url = `https://www.drogasil.com.br/search?w=${ean}&facets=filters.Vendido+por%3ADrogasil&p=1`;
    const skuPattern = /<article[^>]*data-item-id="([^"]+)"[^>]*>/;

    try {
      const sku = await this.streamParseHtml(url, skuPattern, {
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024, // Reduced from 10MB to 5MB
        maxBufferSize: 1 * 1024 * 1024 // Reduced from 2MB to 1MB
      });

      if (!sku) return {};

      const productDetails = await this.getProductDetails(sku);
      if (!productDetails?.success || !productDetails.data?.productBySku) return {};

      return { product: productDetails };
    } catch (error) {
      console.error(`Error fetching Drogasil Product with EAN ${ean}:`, error.message);
      return { error };
    }
  }

  private async getProductDetails(sku: string) {
    const headers = {
      accept: '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty'
    };

    const data = {
      query: `query getProduct($sku: String!) {
          productBySku(sku: $sku) {
            id
            sku
            name
            price
            weight
            price_aux {
              value_to
              lmpm_value_to
              lmpm_qty
            }
            media_gallery_entries {
              file
            }
            pbm {
              id
              name
              products {
                sku
                EAN
                percentDiscountPbm
                valueSalePbm
              }
            }
            liveComposition {
              liveStock {
                qty
              }
              livePrice {
                valueTo
                valueFrom
                discountPercentage
                type
                lmpmValueTo
                lmpmQty
              }
            }
            custom_attributes {
              attribute_code
              value_string
              value {
                id
                label
                __typename
              }
            }
          }
        }`,
      variables: { sku }
    };

    const url = 'https://www.drogaraia.com.br/api/next/middlewareGraphql';

    const response = await this.httpService.axiosRef.post<DrogasilGetProductApiResponse>(url, data, { headers });
    return response.data;
  }

  private async saveEmptyProduct(ean: number, error?: Error): Promise<ProductTypeormEntity> {
    const productEntity = new ProductTypeormEntity();
    productEntity.ean = ean;
    productEntity.origin = Origin.DROGASIL;
    productEntity.error = error?.message || null;

    return this.productRepository.save(productEntity);
  }

  private async saveProduct(ean: number, product: DrogasilGetProductApiResponse): Promise<ProductTypeormEntity> {
    const descriptionAttribute = product.data.productBySku.custom_attributes?.find((attr) => attr.attribute_code === 'description');
    const brandAttribute = product.data.productBySku.custom_attributes?.find((attr) => attr.attribute_code === 'marca');
    const supplierAttribute = product.data.productBySku.custom_attributes?.find((attr) => attr.attribute_code === 'fabricante');
    const rawDescription = descriptionAttribute?.value_string?.join(' ') || '';
    const brand = brandAttribute?.value?.length ? brandAttribute.value[0].label : null
    const supplier = supplierAttribute?.value?.length ? supplierAttribute.value[0].label : null

    const productEntity = new ProductTypeormEntity();
    productEntity.ean = ean;
    productEntity.name = product.data.productBySku.name;
    productEntity.origin = Origin.DROGASIL;
    productEntity.sku = Number(product.data.productBySku.sku || '0');
    productEntity.exists = true;
    productEntity.description = stripHtmlTags(rawDescription);
    productEntity.category = product.data.productBySku.custom_attributes?.find((attr) => attr.attribute_code === 'grupo')?.value_string.join(', ');
    productEntity.weight = product.data.productBySku.weight;
    productEntity.image = product.data.productBySku.media_gallery_entries[0].file;
    productEntity.error = null;
    productEntity.brand = brand;
    productEntity.supplier = supplier;

    if (product.data.productBySku.price_aux) {
      const { value_to, lmpm_value_to, lmpm_qty } = product.data.productBySku.price_aux;

      if (lmpm_value_to && lmpm_qty) {
        productEntity.observation = `Leve ${lmpm_qty} unidades por R$ ${lmpm_value_to.toString().replace('.', ',')} cada`;
      }
      productEntity.price = value_to;
    }

    const { isPbm, pbmPrice } = this.detectDrogasilPbm(product);
    productEntity.isPbm = isPbm;
    if (isPbm && pbmPrice > 0) {
      productEntity.price = pbmPrice;
    }

    await this.saveImages(ean, productEntity, product);

    return this.productRepository.save(productEntity);
  }

  private detectDrogasilPbm(product: DrogasilGetProductApiResponse): { isPbm: boolean; pbmPrice: number } {
    const productData = product.data.productBySku;

    const livePrice = productData.liveComposition?.livePrice;
    if (livePrice?.type === 'PBM') {
      return { isPbm: true, pbmPrice: livePrice.valueTo || 0 };
    }

    const pbmList = productData.pbm;
    if (pbmList?.length) {
      for (const pbm of pbmList) {
        if (!pbm.products?.length) continue;
        for (const pbmProduct of pbm.products) {
          if (pbmProduct.percentDiscountPbm > 0 || pbmProduct.valueSalePbm > 0) {
            return { isPbm: true, pbmPrice: pbmProduct.valueSalePbm || 0 };
          }
        }
      }
    }

    return { isPbm: false, pbmPrice: 0 };
  }

  private async saveImages(ean: number, productEntity: ProductTypeormEntity, productResponse: DrogasilGetProductApiResponse): Promise<void> {
    const existingProduct = await this.productRepository.findByEanAndOrigin(ean, Origin.DROGASIL);
    if (existingProduct?.images?.length) return;

    productEntity.images = productResponse.data.productBySku.media_gallery_entries
      .filter((img) => img.file)
      .map((img) => {
        const imageModel = new ProductImageTypeormEntity();
        imageModel.url = img.file;
        return imageModel;
      });
  }
}
