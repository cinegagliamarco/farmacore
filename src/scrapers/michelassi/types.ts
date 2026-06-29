export interface MichelassiProduct {
  id?: string;
  name?: string;
  description?: string;
  brand?: string;
  min_price_valid?: number;
  erp_internal_code?: string;
  images?: string[];
}

export interface MichelassiSearchResponse {
  data?: MichelassiProduct[];
}
