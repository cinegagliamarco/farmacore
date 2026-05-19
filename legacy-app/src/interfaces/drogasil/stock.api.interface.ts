/* @deprecated */
export interface DrogasilStockApiResponse {
  results: Branch[];
  traceId: string;
  'x-traceId': string;
}

interface Address {
  workingCapital: any;
  typeAddress: any;
  researchCenter: any;
  managerOperations: any;
  mailBox: any;
  locationGeneral: any;
  faxes: any;
  eanBranch: any;
  dept: any;
  accredited: any;
  companyRegistration: any;
  cityItx: any;
  cdCompany: any;
  addressFree: any;
  addressGeneralCode: number;
  district: string;
  city: string;
  detailedAddress: any;
  email: string;
  addressLocal: string;
  addressNumber: string;
  dtUpdatePdv: string;
  idCity: number;
  zipCode: string;
  registration: string;
  codeArea: any;
  registrationDistrict: string;
  latitude: number;
  longitude: number;
  telephone: any;
  amountLotParking: number;
  sgState: string;
}

interface Service {
  branch: number;
  branchCenter: number;
  flagDay1: number;
  flagDay2: number;
  flagDay3: number;
  flagDay4: number;
  flagDay5: number;
  flagDay6: number;
  flagDay7: number;
  flagDeliveryTurbo: number;
  flagUnavailable: number;
  flagOffline: number;
  flagOfflinePing: number;
  hourOpenSunday: string;
  hourOpenNormally: string;
  hourOpenSaturday: string;
  hourEndSunday: string;
  hourEndNormally: string;
  hourEndSaturday: string;
  minutesAppCancel: number;
  minutesAppRejected: number;
}

interface Type {
  id: number;
  branchType: string;
}

interface Complement {
  branchId: number;
  companyBusinessApp: string;
  cellphoneArea: string;
  cellphoneNumber: string;
}

interface Region {
  branchRegionId: any;
  branchMacroRegion: number;
  branchRegion: any;
  flagBranchRegion: any;
  fetchBatchCard: any;
}

interface Executive {
  numberBranchExecutiveId: number;
  nameBranchExecutive: string;
  email: string;
}

interface Branch {
  phone: any;
  phoneShipping: any;
  nameCompany: any;
  invoiceType: any;
  invoiceLayout: any;
  flagNewBranch: any;
  flagBranch: any;
  fax: any;
  dateStartRequestAllotment: any;
  dateReInauguration: any;
  dateLastPickUpOn: any;
  dateCompanyMigration: any;
  dateClosure: any;
  costCenter: any;
  branchGroup: any;
  branchFinancialGroup: any;
  id: number;
  numberCompany: string;
  tradeName: string;
  businessName: string;
  company: number;
  branchCategory: number;
  branchCluster: number;
  branchHistory: number;
  branchOrderBilling: number;
  branchProfile: number;
  branchRegionalMacro: number;
  branchRoute: number;
  branchSaf: number;
  logoTypeCode: number;
  regional: number;
  sngpcState: number;
  invoiceCurve: string;
  costCenterIQ: any;
  email: string;
  dateUpdatePDV: string;
  dateInauguration: string;
  flag24hours: number;
  flagTruckExtra: number;
  flagDrogStorePopular: number;
  flagNewPDV: number;
  codeArea: any;
  numberIE: string;
  flagPark: number;
  distanceKMFromSearch: number;
  typeSearch: string;
  logoType: any;
  type: Type;
  address: Address;
  service: Service;
  regionalManager: any;
  microRegion: any;
  complement: Complement;
  region: Region;
  executive: Executive;
}
