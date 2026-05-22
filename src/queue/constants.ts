import { PipelineStep } from '../database/enums/pipeline-step.enum';

export const EXCHANGE_NAME = `pipeline.${process.env.NODE_ENV ?? 'development'}`;
export const DLX_NAME = `${EXCHANGE_NAME}.dlx`;

export const RETRY_DELAYS_MS: ReadonlyArray<number> = [60_000, 5 * 60_000, 30 * 60_000];
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

export const STEP_PREFETCH: Readonly<Record<PipelineStep, number>> = {
  [PipelineStep.SYNC_BASE_PRODUCT]: 1,
  [PipelineStep.SYNC_BASE_PRODUCT_STOCK]: 1,
  [PipelineStep.SYNC_OFFER_BOOKS_INFO]: 2,
  [PipelineStep.IMPORT_COMPETITOR_PRODUCTS]: 4,
  [PipelineStep.IMPORT_COMPETITOR_STOCK]: 2,
  [PipelineStep.CALC_BASE_PRODUCT_METRICS]: 1,
  [PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES]: 1,
  [PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT]: 2,
};
