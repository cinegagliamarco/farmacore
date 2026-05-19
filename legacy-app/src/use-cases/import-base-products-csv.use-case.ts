import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { BaseProductOrigin } from '../common/base-product-origin.enum';
import { IMPORT_BASE_PRODUCTS_CSV_USE_CASE, IMPORT_PRODUCTS_DROGAL_USE_CASE, IMPORT_PRODUCTS_DROGASIL_USE_CASE } from '../common/import.events';
import { Origin } from '../common/origin.enum';
import { wait } from '../common/wait-for.helper';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductRepository } from '../database/repositories/product.repository';

interface CsvBaseProduct {
  ean: number;
  curve: string;
  mat: number;
  generico: boolean;
}

@Injectable()
export class ImportBaseProductsCsvUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly eventEmitter: EventEmitter2
  ) {}

  @OnEvent(IMPORT_BASE_PRODUCTS_CSV_USE_CASE)
  public async execute(file: string): Promise<void> {
    const parsedProducts = this.parseCsv(file);
    console.log(`Parsed ${parsedProducts.length} products from CSV`);

    const newProductEans: number[] = [];

    for (const parsedProduct of parsedProducts) {
      const existingProduct = await this.baseProductRepository.findOne(parsedProduct.ean);

      if (existingProduct) {
        await this.updateExistingProduct(existingProduct, parsedProduct);
      } else {
        await this.createNewProduct(parsedProduct);
        newProductEans.push(parsedProduct.ean);
      }
    }

    console.log(`Updated ${parsedProducts.length - newProductEans.length} existing products`);
    console.log(`Created ${newProductEans.length} new products`);

    if (newProductEans.length > 0) {
      console.log('Fetching product data from Drogal and Drogasil for new products...');
      await this.fetchProductDataFromCompetitors(newProductEans);
    }
  }

  private parseCsv(file: string): CsvBaseProduct[] {
    const rows = file.split(/\r?\n/);
    const products: CsvBaseProduct[] = [];

    for (let index = 0; index < rows.length; index++) {
      if (!index) continue; // Skip header

      const row = rows[index];
      if (!row.trim()) continue; // Skip empty lines

      const parsedRow = row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g).map((value) => value.replace(/^"|"$/g, '').trim());
      const [ean, curve, mat, generico] = parsedRow;

      const parsedEan = this.parseNumberColumn(ean);
      if (!parsedEan) continue; // Skip invalid EAN

      const sanitizedMat = mat
        .replace(/^R\$\s?/, '')
        .replace(/\./g, '')
        .replace(',', '.');
      const parsedMat = parseFloat(sanitizedMat);
      products.push({
        ean: parsedEan,
        curve: curve || '',
        mat: isNaN(parsedMat) ? null : parsedMat,
        generico: generico?.toLowerCase() === 'sim'
      });
    }

    return products;
  }

  private parseNumberColumn(value: string): number {
    const parsedValue = value.replace(/^0+/, '');
    return Number(parsedValue) || 0;
  }

  private async updateExistingProduct(existingProduct: BaseProductTypeormEntity, csvData: CsvBaseProduct): Promise<void> {
    existingProduct.curve = csvData.curve;
    existingProduct.mat = csvData.mat;
    if (existingProduct.generic === false && csvData.generico === true && existingProduct.origin === BaseProductOrigin.CSV) {
      existingProduct.generic = true;
    }
    await this.baseProductRepository.save(existingProduct);
  }

  private async createNewProduct(csvData: CsvBaseProduct): Promise<BaseProductTypeormEntity> {
    const newProduct = new BaseProductTypeormEntity();
    newProduct.ean = csvData.ean;
    newProduct.curve = csvData.curve;
    newProduct.mat = csvData.mat;
    newProduct.origin = BaseProductOrigin.CSV;
    newProduct.generic = csvData.generico;
    return this.baseProductRepository.save(newProduct);
  }

  private async fetchProductDataFromCompetitors(eans: number[]): Promise<void> {
    // Run Drogal and Drogasil imports sequentially
    console.log('Starting Drogal import for new products...');
    await this.eventEmitter.emitAsync(IMPORT_PRODUCTS_DROGAL_USE_CASE);

    await wait(1000);

    console.log('Starting Drogasil import for new products...');
    await this.eventEmitter.emitAsync(IMPORT_PRODUCTS_DROGASIL_USE_CASE);

    // After imports complete, update base products with name and description from competitor data
    await this.updateBaseProductsFromCompetitorData(eans);
  }

  private async updateBaseProductsFromCompetitorData(eans: number[]): Promise<void> {
    console.log('Updating base products with competitor data...');

    for (const ean of eans) {
      const baseProduct = await this.baseProductRepository.findOne(ean);
      if (!baseProduct) continue;

      // Try to get data from Drogal first, then Drogasil
      const drogalProduct = await this.productRepository.findByEanAndOrigin(ean, Origin.DROGAL);
      const drogasilProduct = await this.productRepository.findByEanAndOrigin(ean, Origin.DROGASIL);

      const name = drogalProduct?.name || drogasilProduct?.name;
      const description = drogalProduct?.description || drogasilProduct?.description;

      if (name) baseProduct.name = name;
      if (description) baseProduct.description = description;

      if (name || description) await this.baseProductRepository.save(baseProduct);
    }

    console.log('Finished updating base products with competitor data');
  }
}
