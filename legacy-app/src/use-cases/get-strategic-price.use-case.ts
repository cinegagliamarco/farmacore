import { Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductFilters } from '../dto/get-crossed-products-query-param.dto';
import { GetStrategicPriceQueryParamDto } from '../dto/get-strategic-price-query-param.dto';

export interface StrategicPrice {
  id: number;
  ean: number;
  name: string;
  supplier: string;
  book: string;
  deals: { quantity: number; totalPrice: number; discount: number }[];
  classification: string;
  cost: string;
  priceForSell: string;
  priceForOffer: string;
  margin: string;
  averageVariation: string;
  status: string;
  drogalPrice?: string;
  drogalDeal?: string;
  drogasilPrice?: string;
  drogasilDeal?: string;
}

@Injectable()
export class GetStrategicPriceUseCase {
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
    supplier
  }: GetStrategicPriceQueryParamDto): Promise<{ rows: StrategicPrice[]; count: number }> {
    const filters: ProductFilters = { books, status, eans, classification, name, supplier };
    const [results, count] = await this.baseProductRepository.getProductsWithObservationsPaginated(page, perPage, sortBy, sortDirection, filters);

    const parsedList: StrategicPrice[] = results.map(({ baseProduct, competitorPrices }) => {
      const supplier = baseProduct.supplier || '-';
      const classification = baseProduct.classificationEntity?.name || '-';
      const cost = baseProduct.cost || 0;
      const priceForSell = baseProduct.price || 0;
      const margin = baseProduct.margin || 0;
      const averageVariation = baseProduct.averageVariation || 0;
      const status = baseProduct.status || '-';

      // Get offer book data - priceForOffer now comes from the offer book
      // Get offer book data - deals now comes from the offer book
      const [book] = baseProduct.offerBooks || [];
      const deals = baseProduct.deals;
      const priceForOffer = book?.priceForOffer || 0;

      return {
        id: baseProduct.id,
        ean: baseProduct.ean,
        name: baseProduct.name,
        supplier,
        book: book?.name || '-',
        classification,
        cost: cost.toFixed(2),
        priceForSell: priceForSell.toFixed(2),
        priceForOffer: priceForOffer.toFixed(2),
        margin: `${margin.toFixed(2)}%`,
        averageVariation: `${averageVariation.toFixed(2)}%`,
        status,
        deals:
          deals && Object.values(deals).length
            ? Object.keys(deals).map((d) => ({
                quantity: Number(d),
                totalPrice: deals[d].totalPrice,
                discount: deals[d].discount,
                itemCadernoOfertaId: deals[d].itemCadernoOfertaId
              }))
            : [],
        drogalPrice: competitorPrices.drogalPrice.toFixed(2),
        drogalDeal: competitorPrices.drogalObservation || '',
        drogasilPrice: competitorPrices.drogasilPrice.toFixed(2),
        drogasilDeal: competitorPrices.drogasilObservation || ''
      };
    });

    return { rows: parsedList, count };
  }
}
