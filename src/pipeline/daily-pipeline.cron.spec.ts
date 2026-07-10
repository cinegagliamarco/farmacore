import { DailyPipelineCron } from './daily-pipeline.cron';
import { TenantService } from '../tenant/tenant.service';
import { PipelinePublisher } from '../queue/pipeline-publisher.service';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';

describe('DailyPipelineCron.fire', () => {
  let tenants: { listActive: jest.Mock };
  let publisher: { publishStart: jest.Mock };
  let metrics: { recordDailyPipelinePublished: jest.Mock };
  let cron: DailyPipelineCron;

  beforeEach(() => {
    delete process.env.WORKER_MODE;
    tenants = {
      listActive: jest.fn().mockResolvedValue([{ slug: 'a' }, { slug: 'b' }]),
    };
    publisher = { publishStart: jest.fn().mockResolvedValue('run-id') };
    metrics = { recordDailyPipelinePublished: jest.fn() };
    cron = new DailyPipelineCron(
      tenants as unknown as TenantService,
      publisher as unknown as PipelinePublisher,
      metrics as unknown as PipelineMetricsRegistry,
    );
  });

  it('keeps publishing after a tenant fails and records the gauge', async () => {
    publisher.publishStart.mockImplementation((slug: string) =>
      slug === 'a'
        ? Promise.reject(new Error('amqp down for a'))
        : Promise.resolve('run-b'),
    );
    await cron.fire();
    expect(publisher.publishStart).toHaveBeenCalledTimes(2);
    expect(publisher.publishStart).toHaveBeenCalledWith(
      'b',
      { reason: 'cron' },
      { producer: 'cron:daily-pipeline' },
    );
    expect(metrics.recordDailyPipelinePublished).toHaveBeenCalledTimes(1);
  });

  it('does NOT record the gauge when every publish fails (AMQP outage)', async () => {
    publisher.publishStart.mockRejectedValue(new Error('amqp down'));
    await cron.fire();
    expect(publisher.publishStart).toHaveBeenCalledTimes(2);
    expect(metrics.recordDailyPipelinePublished).not.toHaveBeenCalled();
  });
});
