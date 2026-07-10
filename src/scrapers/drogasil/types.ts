export interface DrogasilCustomAttribute {
  attribute_code: string;
  value_string?: string[] | string;
  value?: Array<{ id?: string | number; label?: string }>;
}

interface DrogasilPriceAux {
  value_to?: number;
  lmpm_value_to?: number;
  lmpm_qty?: number;
}

interface DrogasilLivePrice {
  type?: string;
  valueTo?: number;
}

interface DrogasilPbmProduct {
  sku?: string;
  EAN?: string;
  percentDiscountPbm?: number;
  valueSalePbm?: number;
}

interface DrogasilPbm {
  products?: DrogasilPbmProduct[];
}

export interface DrogasilProductBySku {
  id?: string;
  sku?: string;
  name?: string;
  price?: number;
  weight?: number;
  price_aux?: DrogasilPriceAux;
  media_gallery_entries?: Array<{ file?: string }>;
  pbm?: DrogasilPbm[];
  liveComposition?: { livePrice?: DrogasilLivePrice };
  custom_attributes?: DrogasilCustomAttribute[];
}

export interface DrogasilProductResponse {
  data?: { productBySku?: DrogasilProductBySku };
  errors?: unknown[];
}
