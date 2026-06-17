/** VTEX catalog_system product shape (Ikesaki), trimmed to the fields
 *  the scraper maps. Same family as Drogal/Pague Menos. */
export interface IkesakiCommertialOffer {
  Price?: number;
  IsAvailable?: boolean;
  PromotionTeasers?: Array<{ Name?: string }>;
}

export interface IkesakiItem {
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: IkesakiCommertialOffer }>;
}

export interface IkesakiProduct {
  productName?: string;
  brand?: string;
  productReferenceCode?: string;
  description?: string;
  items?: IkesakiItem[];
}
