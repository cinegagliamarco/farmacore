export interface MichelassiProduct {
  id?: string;
  name?: string;
  description?: string;
  brand?: string;
  min_price_valid?: number;
  erp_internal_code?: string;
  images?: string[];
  available_stock?: boolean;
  stock_infos?: { stock_balance?: number };
}

export interface MichelassiSearchResponse {
  data?: MichelassiProduct[];
}
