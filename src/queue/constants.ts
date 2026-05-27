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
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  PipelineStep.IMPORT_COMPETITOR_STOCK,
  PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
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
];

export const dispatchStep = (step: PipelineStep): string =>
  `${step}.dispatch`;
export const batchStep = (step: PipelineStep): string => `${step}.batch`;

/** Per-queue prefetch. Keyed by actual queue name (= step + suffix). */
export const STEP_PREFETCH: Readonly<Record<string, number>> = {
  [PipelineStep.SYNC_OFFER_BOOKS_INFO]: 2,
  [PipelineStep.IMPORT_COMPETITOR_PRODUCTS]: 4,
  [PipelineStep.IMPORT_COMPETITOR_STOCK]: 2,
  [PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES]: 1,
  [PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT]: 2,

  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 1,
  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 1,
  [dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 1,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 4,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 4,
  [batchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 2,
};
