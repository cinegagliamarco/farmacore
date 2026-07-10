export enum PipelineStep {
  SYNC_BASE_PRODUCT = 'sync-base-product',
  SYNC_BASE_PRODUCT_STOCK = 'sync-base-product-stock',
  SYNC_OFFER_BOOKS_INFO = 'sync-offer-books-info',
  IMPORT_COMPETITOR_PRODUCTS = 'import-competitor-products',
  CALC_BASE_PRODUCT_METRICS = 'calc-base-product-metrics',
  UPDATE_BASE_PRODUCT_PROPERTIES = 'update-base-product-properties',
  // Per-store data foundation (stores + product_item), runs as a linear
  // tail after the base-product DAG so products are fully synced first.
  SYNC_STORES = 'sync-stores',
  SYNC_PRODUCT_ITEMS = 'sync-product-items',
  // Aplicação de preço em massa (Fase 3 da sugestão de preços) — escreve no
  // ERP via CatalogMutationService. Disparado sob demanda (POST /pricing/apply),
  // fora do DAG diário (standalone).
  APPLY_PRICE = 'apply-price',
  // Execução de regra de oferta (Fase 3 do offer-book-rules) — empurra os
  // items `pending` do report à A7. Disparado por POST /offer-book-rules/:id/execute,
  // fora do DAG diário (standalone).
  EXECUTE_OFFER_BOOK_RULE = 'execute-offer-book-rule',
}
