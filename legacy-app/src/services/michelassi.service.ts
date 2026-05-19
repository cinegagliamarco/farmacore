import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { Origin } from '../common/origin.enum';
import { wait } from '../common/wait-for.helper';
import { ProductStockTypeormEntity } from '../database/entities/product-stock.entity';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { ProductRepository } from '../database/repositories/product.repository';
import { MichelassiApiGetProductApiResponse, MichelassiProduct } from '../interfaces/michelassi/get-product-api.interface';

@Injectable()
export class MichelassiService {
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_BACKOFF_MS = 2_000;

  constructor(
    private readonly productRepository: ProductRepository,
    private readonly httpService: HttpService
  ) {}

  public async importProduct(ean: number): Promise<ProductTypeormEntity> {
    const { product, error } = await this.fetchProductByEan(ean);

    if (!product || error) return this.saveEmptyProduct(ean, error);

    return this.saveProduct(ean, product);
  }

  private async fetchProductByEan(ean: number, attempt = 0): Promise<{ product?: MichelassiProduct; error?: Error }> {
    try {
      const headers = {
        accept: '*/*',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        origin: 'https://supermercadomichelassi.instabuy.com.br',
        pragma: 'no-cache',
        referer: 'https://supermercadomichelassi.instabuy.com.br/',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      };
      const url = `https://api.instabuy.com.br/apiv3/search?subdomain=supermercadomichelassi&search=${ean}&page=1&N=30`;
      const response = await this.httpService.axiosRef.get<MichelassiApiGetProductApiResponse>(url, { headers, timeout: 30000 });

      if (!response.data?.data.length) return {};
      return { product: response.data.data[0] };
    } catch (error) {
      if (this.isRateLimited(error) && attempt < MichelassiService.MAX_RETRIES) {
        const backoff = MichelassiService.BASE_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[MICHELASSI] Rate limited (429) for EAN ${ean}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MichelassiService.MAX_RETRIES})`
        );
        await wait(backoff);
        return this.fetchProductByEan(ean, attempt + 1);
      }

      console.error(`Error fetching Michelassi Product with EAN ${ean}:`, error.message);
      return { error };
    }
  }

  private isRateLimited(error: unknown): boolean {
    return error instanceof AxiosError && error.response?.status === 429;
  }

  private async saveEmptyProduct(ean: number, error?: Error): Promise<ProductTypeormEntity> {
    const productEntity = new ProductTypeormEntity();
    productEntity.ean = ean;
    productEntity.origin = Origin.MICHELASSI;
    productEntity.error = error?.message || null;

    return this.productRepository.save(productEntity);
  }

  /**
   * Memory-optimized product saving with sequential image processing
   */
  private async saveProduct(ean: number, product: MichelassiProduct): Promise<ProductTypeormEntity> {
    const productEntity = new ProductTypeormEntity();

    const existingProduct = await this.productRepository.findByEanAndOrigin(ean, Origin.MICHELASSI);
    if (existingProduct) {
      productEntity.stock = existingProduct.stock;
      productEntity.id = existingProduct.id;
    }

    productEntity.ean = ean;
    productEntity.name = product.name;
    productEntity.origin = Origin.MICHELASSI;
    productEntity.price = product.min_price_valid;
    productEntity.brand = product.brand;
    productEntity.exists = true;
    productEntity.sku = Number(product.erp_internal_code);
    productEntity.description = product.description;
    productEntity.image = product.images?.length ? `https://ibassets.com.br/ib.item.image.large/l-${product.images[0]}.jpeg` : null;
    productEntity.error = null;

    if (!productEntity.stock) productEntity.stock = new ProductStockTypeormEntity();

    productEntity.stock.hasStock = product.available_stock;
    productEntity.stock.subsidiaryOneStock = product.stock_infos?.stock_balance ?? 0;
    productEntity.stock.error = null;

    return this.productRepository.save(productEntity);
  }
}
