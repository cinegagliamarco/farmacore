// Vendor that an integration_database_connection row points at. Different
// from CompetitorOrigin (which classifies scraped competitors). v1 supports
// A7Pharma only — add new values as additional vendors are integrated.
export enum IntegrationOrigin {
  A7PHARMA = 'a7pharma',
}
