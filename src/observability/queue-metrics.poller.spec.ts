import { Test } from '@nestjs/testing';
import { QueueMetricsPoller } from './queue-metrics.poller';
import { AppConfigService } from '../config/app-config.service';
import { PipelineMetricsRegistry } from './pipeline-metrics.registry';

describe('QueueMetricsPoller', () => {
  let poller: QueueMetricsPoller;
  let configValue: {
    amqpMgmt: { apiUrl?: string; user?: string; pass?: string };
  };
  let metrics: { updateRmqQueues: jest.Mock };

  beforeEach(async () => {
    configValue = { amqpMgmt: {} };
    metrics = { updateRmqQueues: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        QueueMetricsPoller,
        { provide: AppConfigService, useValue: configValue },
        { provide: PipelineMetricsRegistry, useValue: metrics },
      ],
    }).compile();
    poller = mod.get(QueueMetricsPoller);
  });

  it('does nothing when all mgmt vars are empty', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never);
    await expect(poller.poll()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('polls with AMQP_MGMT_* vars', async () => {
    configValue.amqpMgmt = {
      apiUrl: 'https://broker/api',
      user: 'farmacore',
      pass: 'secret',
    };
    const queues = [{ name: 'sync-base-product', messages: 3 }];
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(queues),
    } as never);
    await poller.poll();
    expect(fetchSpy).toHaveBeenCalledWith('https://broker/api/queues', {
      headers: { authorization: expect.stringMatching(/^Basic /) },
    });
    expect(metrics.updateRmqQueues).toHaveBeenCalledWith(queues);
    fetchSpy.mockRestore();
  });

  it('swallows fetch errors and logs a warning', async () => {
    configValue.amqpMgmt = { apiUrl: 'https://x/api', user: 'u', pass: 'p' };
    const fetchSpy = jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValue(new Error('network down') as never);
    await expect(poller.poll()).resolves.toBeUndefined();
    expect(metrics.updateRmqQueues).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
