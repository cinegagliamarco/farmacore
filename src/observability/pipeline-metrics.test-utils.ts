import { PipelineMetricsRegistry } from './pipeline-metrics.registry';

/** No-op metrics for unit tests that exercise queue/pipeline consumers. */
export const noopPipelineMetrics = (): jest.Mocked<
  Pick<
    PipelineMetricsRegistry,
    | 'onPublish'
    | 'onConsumeStart'
    | 'onConsumeEnd'
    | 'onDispatchBatches'
    | 'onScrapeDispatch'
    | 'setOutboxDrainBatchSize'
  >
> => ({
  onPublish: jest.fn(),
  onConsumeStart: jest.fn(),
  onConsumeEnd: jest.fn(),
  onDispatchBatches: jest.fn(),
  onScrapeDispatch: jest.fn(),
  setOutboxDrainBatchSize: jest.fn(),
});
