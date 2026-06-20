/** VTEX catalog_system product shape (Drogaria Venâncio), trimmed to the
 *  fields the scraper maps. Same family as Pague Menos. */
export interface VenancioCommertialOffer {
  Price?: number;
  IsAvailable?: boolean;
  PromotionTeasers?: Array<{ Name?: string }>;
}

export interface VenancioItem {
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: VenancioCommertialOffer }>;
}

export interface VenancioProduct {
  productName?: string;
  brand?: string;
  productReferenceCode?: string;
  description?: string;
  items?: VenancioItem[];
}
