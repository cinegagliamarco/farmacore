/** VTEX catalog_system product shape (Drogaria São Paulo — grupo DPSP),
 *  trimmed to the fields the scraper maps. Same family as Pague Menos. */
export interface SaoPauloCommertialOffer {
  Price?: number;
  IsAvailable?: boolean;
  PromotionTeasers?: Array<{ Name?: string }>;
}

export interface SaoPauloItem {
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: SaoPauloCommertialOffer }>;
}

export interface SaoPauloProduct {
  productName?: string;
  brand?: string;
  productReferenceCode?: string;
  description?: string;
  items?: SaoPauloItem[];
}
