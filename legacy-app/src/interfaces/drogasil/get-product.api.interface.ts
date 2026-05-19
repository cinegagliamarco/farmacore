export interface DrogasilPbmProduct {
  sku: string;
  EAN: string;
  promotion: string;
  label: string;
  percentualDiscont: number;
  percentDiscountPbm: number;
  valueSalePbm: number;
}

export interface DrogasilPbm {
  id: string;
  name: string;
  products: DrogasilPbmProduct[];
}

export interface DrogasilLivePrice {
  valueTo: number;
  valueFrom: number;
  discountPercentage: number;
  type: string;
  lmpmValueTo: number;
  lmpmQty: number;
}

export interface DrogasilGetProductApiResponse {
  success: boolean;
  data: {
    productBySku: {
      id: number;
      sku: string;
      name: string;
      weight: number;
      price_aux: {
        value_to: number;
        lmpm_value_to: number;
        lmpm_qty: number;
      };
      media_gallery_entries: {
        file: string;
      }[];
      liveComposition: {
        liveStock: {
          qty: number;
        };
        livePrice?: DrogasilLivePrice;
      };
      pbm?: DrogasilPbm[];
      custom_attributes: {
        attribute_code: string;
        value_string: string[];
        value: {
          id: string;
          label: string;
          __typename: string;
        }[];
      }[];
    };
  };
}
