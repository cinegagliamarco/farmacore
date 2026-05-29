import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export const EXCHANGE_NAME = `pipeline.${process.env.NODE_ENV ?? 'development'}`;
export const DLX_NAME = `${EXCHANGE_NAME}.dlx`;

/**
 * v1 single-queue steps — those that still ship one queue per logical
 * step. Steps migrated to the v2 dispatcher/batch shape leave this
 * list (and gain entries in `BATCHED_STEPS` instead).
 */
export const STEP_QUEUES: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_OFFER_BOOKS_INFO,
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

export const dispatchStep = (step: PipelineStep): string => `${step}.dispatch`;
export const batchStep = (step: PipelineStep): string => `${step}.batch`;
export const originStep = (
  step: PipelineStep,
  origin: CompetitorOrigin,
): string => `${step}.${origin}`;

/**
 * Per-queue prefetch (= concurrency). Keyed by actual queue name.
 * Mirrors legacy per-process concurrency: the bulk-DB steps ran their
 * 1000-row batches sequentially (prefetch 1); the scrapers ran N
 * requests in parallel per origin (DROGAL 20, DROGASIL 10, MICHELASSI 1
 * — see legacy ORIGIN_CONFIGS), and since each scrape is now one
 * message per EAN, that concurrency IS the prefetch. Stock fetches were
 * sequential batched calls (50/30 SKUs each), so prefetch 1.
 */
export const STEP_PREFETCH: Readonly<Record<string, number>> = {
  [PipelineStep.SYNC_OFFER_BOOKS_INFO]: 1,

  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 1,
  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 1,
  [dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 1,
  [dispatchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 1,
  [dispatchStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS)]: 1,
  [dispatchStep(PipelineStep.IMPORT_COMPETITOR_STOCK)]: 1,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 1,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 1,
  [batchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 1,
  [batchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 1,

  // per-origin scrape consumers: one message per EAN, prefetch = legacy
  // per-origin parallel request count.
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.DROGAL,
  )]: 20,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.DROGASIL,
  )]: 10,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.MICHELASSI,
  )]: 1,
  // stock: sequential batched calls per origin (50/30 SKUs each).
  [originStep(PipelineStep.IMPORT_COMPETITOR_STOCK, CompetitorOrigin.DROGAL)]: 1,
  [originStep(PipelineStep.IMPORT_COMPETITOR_STOCK, CompetitorOrigin.DROGASIL)]:
    1,
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
