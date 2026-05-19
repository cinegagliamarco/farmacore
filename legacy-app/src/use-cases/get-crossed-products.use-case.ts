import { Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { GetCrossedProductsQueryParamDto, ProductFilters } from '../dto/get-crossed-products-query-param.dto';

export interface CrossedProducts {
  id: number;
  ean: number;
  name: string;
  supplier: string;
  classification: string;
  book: string;
  cost: string;
  priceForSell: string;
  priceForOffer: string;
  margin: string;
  drogalPrice?: string;
  drogalIsPbm?: boolean;
  drogalVan?: string;
  drogasilPrice?: string;
  drogasilIsPbm?: boolean;
  michelassiPrice?: string;
  averageVariation?: string;
  receiptDate: string;
  status: string;
  monitored: boolean;
}

@Injectable()
export class GetCrossedProductsUseCase {
  constructor(private readonly baseProductRepository: BaseProductRepository) {}

  public async execute({
    page,
    perPage,
    sortBy,
    sortDirection,
    books,
    status,
    eans,
    classification,
    name,
    supplier,
    startReceiptDate,
    endReceiptDate
  }: GetCrossedProductsQueryParamDto): Promise<{ rows: CrossedProducts[]; count: number }> {
    const filters: ProductFilters = { books, status, eans, classification, name, supplier, startReceiptDate, endReceiptDate };
    const [results, count] = await this.baseProductRepository.getProductsCrossedPaginatedWithSort(page, perPage, sortBy, sortDirection, filters);

    const parsedList: CrossedProducts[] = results.map(({ baseProduct, competitorPrices }) => {
      // Get values from synchronized base_product columns
      const supplier = baseProduct.supplier || '-';
      const classification = baseProduct.classificationEntity?.name || '-';
      const cost = baseProduct.cost || 0;
      const priceForSell = baseProduct.price || 0;
      const margin = baseProduct.margin || 0;
      const averageVariation = baseProduct.averageVariation || 0;
      const status = baseProduct.status || '-';
      const receiptDate = baseProduct.receiptDate || '-'

      // Get offer book data - priceForOffer now comes from the offer book
      const [book] = baseProduct.offerBooks || [];
      const priceForOffer = book?.priceForOffer || 0;

      return {
        id: baseProduct.id,
        ean: baseProduct.ean,
        name: baseProduct.name,
        supplier,
        classification,
        book: book?.name || '-',
        cost: cost.toFixed(2),
        priceForSell: priceForSell.toFixed(2),
        priceForOffer: priceForOffer.toFixed(2),
        margin: `${margin.toFixed(2)}%`,
        drogalPrice: competitorPrices.drogalPrice.toFixed(2),
        drogalIsPbm: competitorPrices.drogalIsPbm,
        drogalVan: competitorPrices.drogalVan,
        drogasilPrice: competitorPrices.drogasilPrice.toFixed(2),
        drogasilIsPbm: competitorPrices.drogasilIsPbm,
        michelassiPrice: competitorPrices.michelassiPrice.toFixed(2),
        averageVariation: `${averageVariation.toFixed(2)}%`,
        receiptDate,
        status,
        monitored: baseProduct.monitored
      };
    });

    return { rows: parsedList, count };
  }
}
