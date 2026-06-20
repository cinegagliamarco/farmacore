/** VTEX catalog_system product shape (Drogaria Pacheco — grupo DPSP),
 *  trimmed to the fields the scraper maps. Same family as Pague Menos. */
export interface PachecoCommertialOffer {
  Price?: number;
  IsAvailable?: boolean;
  PromotionTeasers?: Array<{ Name?: string }>;
}

export interface PachecoItem {
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: PachecoCommertialOffer }>;
}

export interface PachecoProduct {
  productName?: string;
  brand?: string;
  productReferenceCode?: string;
  description?: string;
  items?: PachecoItem[];
}
