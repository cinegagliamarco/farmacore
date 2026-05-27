import { PipelineStep } from '../database/enums/pipeline-step.enum';

export const EXCHANGE_NAME = `pipeline.${process.env.NODE_ENV ?? 'development'}`;
export const DLX_NAME = `${EXCHANGE_NAME}.dlx`;

export const RETRY_DELAYS_MS: ReadonlyArray<number> = [
  60_000,
  5 * 60_000,
  30 * 60_000,
];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export const STEP_QUEUES: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_BASE_PRODUCT,
  PipelineStep.SYNC_BASE_PRODUCT_STOCK,
  PipelineStep.SYNC_OFFER_BOOKS_INFO,
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  PipelineStep.IMPORT_COMPETITOR_STOCK,
  PipelineStep.CALC_BASE_PRODUCT_METRICS,
  PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
  PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT,
];

export const PIPELINE_START_QUEUE = 'pipeline.start';
export const MIGRATE_TENANT_QUEUE = 'migrate-tenant';

/**
 * v2 dispatcher/batch step suffixes. The high-level PipelineStep names
 * (e.g. 'sync-base-product') stay as the units of the dependency graph,
 * but each batched step is implemented as two queues:
 *   <step>.dispatch — one msg per (tenant, run); scans source, emits batches
 *   <step>.batch    — N msgs per (tenant, run); does ~500 rows each
 * Scrape steps additionally split per origin: <step>.<origin>.
 */
export type CompetitorOrigin = 'drogal' | 'drogasil' | 'michelassi';

export const PRODUCT_SCRAPE_ORIGINS: ReadonlyArray<CompetitorOrigin> = [
  'drogal',
  'drogasil',
  'michelassi',
];

export const STOCK_SCRAPE_ORIGINS: ReadonlyArray<CompetitorOrigin> = [
  'drogal',
  'drogasil',
];

export const BATCHED_STEPS: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_BASE_PRODUCT,
  PipelineStep.SYNC_BASE_PRODUCT_STOCK,
  PipelineStep.CALC_BASE_PRODUCT_METRICS,
  PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
];

export const PER_ORIGIN_STEPS: ReadonlyArray<PipelineStep> = [
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  PipelineStep.IMPORT_COMPETITOR_STOCK,
];

export const SINGLE_SHOT_STEPS: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_OFFER_BOOKS_INFO,
  PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT,
];

export const dispatchStep = (step: PipelineStep): string =>
  `${step}.dispatch`;
export const batchStep = (step: PipelineStep): string => `${step}.batch`;
export const originStep = (
  step: PipelineStep,
  origin: CompetitorOrigin,
): string => `${step}.${origin}`;

export const originsForStep = (
  step: PipelineStep,
): ReadonlyArray<CompetitorOrigin> => {
  if (step === PipelineStep.IMPORT_COMPETITOR_PRODUCTS)
    return PRODUCT_SCRAPE_ORIGINS;
  if (step === PipelineStep.IMPORT_COMPETITOR_STOCK)
    return STOCK_SCRAPE_ORIGINS;
  return [];
};

/**
 * Prefetch is keyed by the actual queue name (= step string), not the
 * high-level PipelineStep. v1 single-step entries coexist with v2's
 * dispatch/batch/per-origin entries; they will be pruned as v2
 * consumers replace v1 ones (Phase B onward).
 */
export const STEP_PREFETCH: Readonly<Record<string, number>> = {
  // v1 entries (used by current consumers; pruned per-step as v2 lands)
  [PipelineStep.SYNC_BASE_PRODUCT]: 1,
  [PipelineStep.SYNC_BASE_PRODUCT_STOCK]: 1,
  [PipelineStep.SYNC_OFFER_BOOKS_INFO]: 2,
  [PipelineStep.IMPORT_COMPETITOR_PRODUCTS]: 4,
  [PipelineStep.IMPORT_COMPETITOR_STOCK]: 2,
  [PipelineStep.CALC_BASE_PRODUCT_METRICS]: 1,
  [PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES]: 1,
  [PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT]: 2,

  // v2: dispatchers are one-shot per run
  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 1,
  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 1,
  [dispatchStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS)]: 1,
  [dispatchStep(PipelineStep.IMPORT_COMPETITOR_STOCK)]: 1,
  [dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 1,
  [dispatchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 1,

  // v2: DB-bound batch consumers
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 4,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 4,
  [batchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 2,
  [batchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 4,

  // v2: per-origin scrape consumers — these numbers ARE the concurrency
  [originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, 'drogal')]: 8,
  [originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, 'drogasil')]: 8,
  [originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, 'michelassi')]: 2,
  [originStep(PipelineStep.IMPORT_COMPETITOR_STOCK, 'drogal')]: 4,
  [originStep(PipelineStep.IMPORT_COMPETITOR_STOCK, 'drogasil')]: 4,
};
