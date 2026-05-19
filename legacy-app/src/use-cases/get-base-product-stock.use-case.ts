import { Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { GetBaseProductStockQueryParamDto, ProductStockFilters } from '../dto/get-base-product-stock-query-param.dto';
import { Origin } from '../common/origin.enum';
import { BaseProductOrigin } from '../common/base-product-origin.enum';
import { StockStatus } from '../common/stock-status.enum';

export interface BaseProcutStock {
  id: number;
  ean: number;
  name: string;
  supplier: string;
  book: string;
  classification: string;
  cost: string;
  priceForSell: string;
  priceForOffer: string;
  margin: string;
  curve: string;
  mat: number;
  origin: BaseProductOrigin;
  stock: Record<string, number>;
  drogalStock: Record<string, number>;
  drogasilStock: Record<string, number>;
  michelassiStock: Record<string, number>;
  stockStatus: StockStatus;
}

@Injectable()
export class GetBaseProductStockUseCase {
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
    curve,
    origin,
    stockStatus
  }: GetBaseProductStockQueryParamDto): Promise<{ rows: BaseProcutStock[]; count: number }> {
    const filters: ProductStockFilters = { books, status, eans, classification, name, supplier, curve, origin, stockStatus };
    const [results, count] = await this.baseProductRepository.findAllWithStockPaginated(page, perPage, sortBy, sortDirection, filters);

    const parsedList = results.map(({ baseProduct, products, stockStatus: computedStockStatus }) => {
      const drogalProducts = products.filter(({ product }) => product.origin === Origin.DROGAL);
      const drogasilProducts = products.filter(({ product }) => product.origin === Origin.DROGASIL);
      const MichelassiProducts = products.filter(({ product }) => product.origin === Origin.MICHELASSI);
      const cost = baseProduct.cost || 0;
      const priceForSell = baseProduct.price || 0;
      const margin = baseProduct.margin || 0;
      const [book] = baseProduct.offerBooks || [];
      const priceForOffer = book?.priceForOffer || 0;
      const supplier = baseProduct.supplier || '-';
      const classification = baseProduct.classificationEntity?.name || '-';
      const stock = {};
      const drogalStock = {
        drogal1: drogalProducts[0]?.productStock?.subsidiaryOneStock || 0,
        drogal2: drogalProducts[0]?.productStock?.subsidiaryTwoStock || 0
      };
      const drogasilStock = {
        drogasil: drogasilProducts[0]?.productStock?.subsidiaryOneStock || 0
      };
      const michelassiStock = {
        michelassi: MichelassiProducts[0]?.productStock?.subsidiaryOneStock || 0
      };
      baseProduct.stocks.forEach((stockItem) => {
        stock[stockItem.subsidiaryName] = stockItem.quantity;
      });

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
        mat: baseProduct.mat,
        curve: baseProduct.curve || '-',
        origin: baseProduct.origin,
        stock,
        drogalStock,
        drogasilStock,
        michelassiStock,
        stockStatus: computedStockStatus
      };
    });

    return { rows: parsedList, count };
  }
}
