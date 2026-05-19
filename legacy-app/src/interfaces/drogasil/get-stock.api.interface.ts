export interface AddressType {
  district: string;
  addressLocal: string;
  addressNumber: string;
  city: string;
  sgState: string;
}

export interface BranchServiceType {
  hourOpenNormaly: string;
  hourEndNormaly: string;
}

export interface LogoType {
  id: string;
  description: string;
}

export interface BranchType {
  id: string;
  businessName: string;
  flag24hours: boolean;
  distanceKMFromSearch: number;
  address: AddressType;
  branchService: BranchServiceType;
  logoType: LogoType;
}

export interface StockType {
  sku: string;
  quantity: number;
}

export interface NearbyStockByZipCodeType {
  branch: BranchType;
  stocks: StockType[];
}

export interface GetStockApiResponse {
  errors?: unknown;
  data: {
    getNearbyStockByZipCode: NearbyStockByZipCodeType[];
  };
}
