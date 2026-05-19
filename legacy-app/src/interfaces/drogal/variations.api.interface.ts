export interface DrogalVariationsMeasures {
  cubicweight: number;
  height: number;
  length: number;
  weight: number;
  width: number;
}

export interface DrogalVariationsSku {
  sku: number;
  skuname: string;
  available: boolean;
  availablequantity: number;
  listPrice: number;
  bestPrice: number;
  spotPrice: number;
  image: string;
  sellerId: string;
  seller: string;
  measures: DrogalVariationsMeasures;
  unitMultiplier: number;
}

export interface DrogalVariationsApiResponse {
  productId: number;
  name: string;
  salesChannel: string;
  available: boolean;
  skus: DrogalVariationsSku[];
}
