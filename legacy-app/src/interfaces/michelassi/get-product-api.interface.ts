export interface MichelassiApiGetProductApiResponse {
  data: MichelassiProduct[];
  status: string;
  count: number;
  http_status: number;
  source: string;
}

export interface MichelassiProduct {
  id: string;
  created_at: string;
  item_type: string;
  erp_internal_code: string;
  subcategory_ids: string[];
  main_subcategory: string;
  store_id: string;
  visible: boolean;
  block_sale: boolean;
  description: string;
  images: string[];
  name: string;
  name_on_erp: string;
  custom_infos: any[];
  prices: MichelassiPrice[];
  min_price_valid: number;
  stock_infos: MichelassiStockInfo;
  variation_items: any[];
  related_items: any[];
  slug: string;
  brand: string;
  unit_type: string;
  increment_value: number;
  copy_of: string;
  shipping: MichelassiShipping;
  available_stock: boolean;
}

export interface MichelassiPrice {
  id: string;
  title: string;
  internal_code: string;
  price: number;
  bar_codes: string[];
  qtd_stock: number;
}

export interface MichelassiStockInfo {
  stock_balance: number;
  should_block_on_stock_hole: boolean;
}

export interface MichelassiShipping {
  deliverable: boolean;
}