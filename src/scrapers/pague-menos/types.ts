/** VTEX catalog_system product shape (Pague Menos), trimmed to the
 *  fields the scraper maps. Same family as Drogal/Ikesaki. */
export interface PagueMenosCommertialOffer {
  Price?: number;
  IsAvailable?: boolean;
  PromotionTeasers?: Array<{ Name?: string }>;
}

export interface PagueMenosItem {
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: PagueMenosCommertialOffer }>;
}

export interface PagueMenosProduct {
  productName?: string;
  brand?: string;
  productReferenceCode?: string;
  description?: string;
  items?: PagueMenosItem[];
}
