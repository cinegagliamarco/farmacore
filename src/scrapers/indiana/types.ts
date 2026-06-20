/** VTEX catalog_system product shape (Farmácia Indiana), trimmed to the
 *  fields the scraper maps. Same family as Pague Menos. */
export interface IndianaCommertialOffer {
  Price?: number;
  IsAvailable?: boolean;
  PromotionTeasers?: Array<{ Name?: string }>;
}

export interface IndianaItem {
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: IndianaCommertialOffer }>;
}

export interface IndianaProduct {
  productName?: string;
  brand?: string;
  productReferenceCode?: string;
  description?: string;
  items?: IndianaItem[];
}
