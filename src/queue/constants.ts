import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export const EXCHANGE_NAME = `pipeline.${process.env.NODE_ENV ?? 'development'}`;
export const DLX_NAME = `${EXCHANGE_NAME}.dlx`;

/** amqp-connection-manager default is 5s — too aggressive for long scrapes. */
export const AMQP_HEARTBEAT_INTERVAL_SECONDS = 120;

/** Block duplicate delivery only while a batch is actively running (ms). */
export const ACTIVE_BATCH_LOCK_MS = 5 * 60 * 1000;

/**
 * v1 single-queue steps — those that still ship one queue per logical
 * step. Steps migrated to the v2 dispatcher/batch shape leave this
 * list (and gain entries in `BATCHED_STEPS` instead).
 */
export const STEP_QUEUES: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_OFFER_BOOKS_INFO,
  PipelineStep.SYNC_STORES,
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
  PipelineStep.APPLY_PRICE,
  PipelineStep.SYNC_PRODUCT_ITEMS,
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
    CompetitorOrigin.PAGUE_MENOS,
    CompetitorOrigin.IKESAKI,
    CompetitorOrigin.PACHECO,
    CompetitorOrigin.SAO_PAULO,
    CompetitorOrigin.VENANCIO,
    CompetitorOrigin.INDIANA,
  ],
};

export const dispatchStep = (step: PipelineStep): string => `${step}.dispatch`;
export const batchStep = (step: PipelineStep): string => `${step}.batch`;
export const originStep = (
  step: PipelineStep,
  origin: CompetitorOrigin,
): string => `${step}.${origin}`;

/**
 * Every consumer queue name that has a `<name>.dlq` mirror — the single
 * source of truth for the DLQ tooling (DlqService). Covers v1
 * single-queue steps, v2 batched steps (dispatch + batch), per-origin
 * scrape steps (dispatch + per origin), plus pipeline.start and
 * migrate-tenant.
 */
export const allStepQueueNames = (): string[] => {
  const names: string[] = [
    ...STEP_QUEUES,
    PIPELINE_START_QUEUE,
    MIGRATE_TENANT_QUEUE,
  ];
  for (const step of BATCHED_STEPS) {
    names.push(dispatchStep(step), batchStep(step));
  }
  for (const [stepKey, origins] of Object.entries(PER_ORIGIN_STEPS)) {
    const step = stepKey as PipelineStep;
    if (!origins) continue;
    names.push(dispatchStep(step));
    for (const origin of origins) names.push(originStep(step, origin));
  }
  return names;
};

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
  [PipelineStep.SYNC_STORES]: 1,

  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 1,
  [dispatchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 1,
  [dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 1,
  [dispatchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 1,
  [dispatchStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS)]: 1,
  [dispatchStep(PipelineStep.SYNC_PRODUCT_ITEMS)]: 1,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT)]: 1,
  [batchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK)]: 1,
  [batchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS)]: 1,
  [batchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES)]: 1,
  [batchStep(PipelineStep.SYNC_PRODUCT_ITEMS)]: 1,

  // apply em massa: escrita no ERP é serial (prefetch 1) por segurança.
  [dispatchStep(PipelineStep.APPLY_PRICE)]: 1,
  [batchStep(PipelineStep.APPLY_PRICE)]: 1,

  // per-origin scrape consumers: one message per EAN. Prefetch is capped for
  // the Fly worker (single Node event loop) — sum across origins must stay low
  // or AMQP heartbeats stall during long HTTP scrapes.
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.DROGAL,
  )]: 2,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.DROGASIL,
  )]: 2,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.MICHELASSI,
  )]: 1,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.PAGUE_MENOS,
  )]: 1,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.IKESAKI,
  )]: 1,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.PACHECO,
  )]: 1,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.SAO_PAULO,
  )]: 1,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.VENANCIO,
  )]: 1,
  [originStep(
    PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    CompetitorOrigin.INDIANA,
  )]: 1,
};
