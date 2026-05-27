import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export const EXCHANGE_NAME = `pipeline.${process.env.NODE_ENV ?? 'development'}`;
export const DLX_NAME = `${EXCHANGE_NAME}.dlx`;

export const RETRY_DELAYS_MS: ReadonlyArray<number> = [
  60_000,
  5 * 60_000,
  30 * 60_000,
];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * v1 single-queue steps — those that still ship one queue per logical
 * step. Steps migrated to the v2 dispatcher/batch shape leave this
 * list (and gain entries in `BATCHED_STEPS` instead).
 */
export const STEP_QUEUES: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_OFFER_BOOKS_INFO,
  PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT,
];

export const PIPELINE_START_QUEUE = 'pipeline.start';
export const MIGRATE_TENANT_QUEUE = 'migrate-tenant';

/**
 * v2 batched steps — implemented as two queues each: `<step>.dispatch`
 * (one msg per run, scans source, emits batches) and `<step>.batch`
 * (N msgs per run, ~500 rows each). Grows as each batched step lands.
 */
export const BATCHED_STEPS: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_BASE_PRODUCT,
  PipelineStep.SYNC_BASE_PRODUCT_STOCK,
  PipelineStep.CALC_BASE_PRODUCT_METRICS,
  PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
];

/**
 * v2 per-origin steps — one `<step>.dispatch` + one queue per origin
 * (`<step>.<ORIGIN>`). The per-origin queues are the rate-limit knob:
 * each origin gets its own prefetch (drogal=8, drogasil=8, michelassi=2).
 */
export const PER_ORIGIN_STEPS: Readonly<
  Partial<Record<PipelineStep, ReadonlyArray<CompetitorOrigin>>>
> = {
  [PipelineStep.IMPORT_COMPETITOR_PRODUCTS]: [
    CompetitorOrigin.DROGAL,
    CompetitorOrigin.DROGASIL,
    CompetitorOrigin.MICHELASSI,
  ],
  [PipelineStep.IMPORT_COMPETITOR_STOCK]: [
    CompetitorOrigin.DROGAL,
    CompetitorOrigin.DROGASIL,
  ],
};

export const dispatchStep = (step: PipelineStep): string =>
  `${step}.dispatch`;
export const batchStep = (step: PipelineStep): string => `${step}.batch`;
export const originStep = (
  step: PipelineStep,
  origin: CompetitorOrigin,
): string => `${step}.${origin}`;

/** Per-queue prefetch. Keyed by actual queue name (= step + suffix). */
export const STEP_PREFETCH: Readonly<Record<string, number>> = {
  [PipelineStep.SYNC_OFFER_BOOKS_INFO]: 2,
  [PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT]: 2,

  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 1,
  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 1,
  [dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 1,
  [dispatchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 1,
  [dispatchStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS)]: 1,
  [dispatchStep(PipelineStep.IMPORT_COMPETITOR_STOCK)]: 1,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 4,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 4,
  [batchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 2,
  [batchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 4,

  // per-origin scrape consumers: prefetch IS the rate limit
  [originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, CompetitorOrigin.DROGAL)]: 8,
  [originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, CompetitorOrigin.DROGASIL)]: 8,
  [originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, CompetitorOrigin.MICHELASSI)]: 2,
  [originStep(PipelineStep.IMPORT_COMPETITOR_STOCK, CompetitorOrigin.DROGAL)]: 4,
  [originStep(PipelineStep.IMPORT_COMPETITOR_STOCK, CompetitorOrigin.DROGASIL)]: 4,
};

/**
 * Per-origin batch sizes (EANs per message). The v2 plan matches the
 * legacy ORIGIN_CONFIGS in-process batch sizes. Drogal can handle 20
 * EANs serially per message; Michelassi gets 1 (legacy aggressive
 * rate limiting).
 */
export const PER_ORIGIN_BATCH_SIZE: Readonly<Record<CompetitorOrigin, number>> = {
  [CompetitorOrigin.DROGAL]: 20,
  [CompetitorOrigin.DROGASIL]: 10,
  [CompetitorOrigin.MICHELASSI]: 1,
  [CompetitorOrigin.PAGUE_MENOS]: 20,
  [CompetitorOrigin.IKESAKI]: 10,
};

/**
 * Per-origin batch size for stock fetches. Legacy ran 50 SKUs per call
 * on Drogal (one drogalCheckout POST with all SKUs) and 30 on Drogasil
 * (one GraphQL call). Michelassi is not in stock — products-only.
 */
export const PER_ORIGIN_STOCK_BATCH_SIZE: Readonly<
  Partial<Record<CompetitorOrigin, number>>
> = {
  [CompetitorOrigin.DROGAL]: 50,
  [CompetitorOrigin.DROGASIL]: 30,
};
