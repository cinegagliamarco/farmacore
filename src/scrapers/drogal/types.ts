/**
 * Minimal slices of the Drogal API responses — only the fields the
 * scraper reads. Adding new fields here is cheap; the full API
 * shape lives in the legacy interfaces if needed.
 */

export interface DrogalCustomData {
  pbmPrice?: number;
}

export interface DrogalCommertialOffer {
  Price: number;
  PromotionTeasers?: Array<{ Name?: string }>;
}

export interface DrogalSeller {
  commertialOffer?: DrogalCommertialOffer;
}

export interface DrogalImage {
  imageUrl?: string;
}

export interface DrogalItem {
  sellers?: DrogalSeller[];
  images?: DrogalImage[];
}

export interface DrogalProduct {
  productId: string;
  productName?: string;
  productReferenceCode?: string;
  brand?: string;
  description?: string;
  items?: DrogalItem[];
  CustomData?: string[];
  VAN?: string[];
  PBM?: string[];
}

export interface DrogalMeasures {
  cubicweight?: number;
  height?: number;
  length?: number;
  weight?: number;
  width?: number;
}

export interface DrogalVariationsResponse {
  skus?: Array<{ measures?: DrogalMeasures }>;
}

export interface DrogalStockResponse {
  body?: {
    pickupPointItems?: Array<{
      CodigoFilial: number;
      CartDetail?: Array<{
        productRefId: number;
        quantityAvaliable?: number;
        avaliable?: boolean;
      }>;
    }>;
  };
}
