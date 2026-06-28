export enum PipelineStep {
  SYNC_BASE_PRODUCT = 'sync-base-product',
  SYNC_BASE_PRODUCT_STOCK = 'sync-base-product-stock',
  SYNC_OFFER_BOOKS_INFO = 'sync-offer-books-info',
  IMPORT_COMPETITOR_PRODUCTS = 'import-competitor-products',
  CALC_BASE_PRODUCT_METRICS = 'calc-base-product-metrics',
  UPDATE_BASE_PRODUCT_PROPERTIES = 'update-base-product-properties',
  // Aplicação de preço em massa (Fase 3 da sugestão de preços) — escreve no
  // ERP via CatalogMutationService. Disparado sob demanda (POST /pricing/apply),
  // fora do DAG diário (standalone).
  APPLY_PRICE = 'apply-price',
}
