import { Test } from '@nestjs/testing';
import { QueueMetricsPoller } from './queue-metrics.poller';
import { AppConfigService } from '../config/app-config.service';

describe('QueueMetricsPoller', () => {
  let poller: QueueMetricsPoller;
  let configValue: {
    amqpMgmt: { apiUrl?: string; user?: string; pass?: string };
  };

  beforeEach(async () => {
    configValue = { amqpMgmt: {} };
    const mod = await Test.createTestingModule({
      providers: [
        QueueMetricsPoller,
        { provide: AppConfigService, useValue: configValue },
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
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([{ name: 'sync-base-product', messages: 3 }]),
    } as never);
    await poller.poll();
    expect(fetchSpy).toHaveBeenCalledWith('https://broker/api/queues', {
      headers: { authorization: expect.stringMatching(/^Basic /) },
    });
    fetchSpy.mockRestore();
  });

  it('polls with legacy CLOUDAMQP_API_* vars via amqpMgmt fallback', async () => {
    configValue.amqpMgmt = {
      apiUrl: 'https://x/api',
      user: 'u',
      pass: 'p',
    };
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { name: 'sync-base-product', messages: 3 },
          { name: 'sync-base-product.dlq', messages: 0 },
        ]),
    } as never);
    await poller.poll();
    const last = (poller as unknown as { last: Array<{ name: string }> }).last;
    expect(last).toHaveLength(2);
    expect(last[0].name).toBe('sync-base-product');
    fetchSpy.mockRestore();
  });

  it('swallows fetch errors and logs a warning', async () => {
    configValue.amqpMgmt = { apiUrl: 'https://x/api', user: 'u', pass: 'p' };
    const fetchSpy = jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValue(new Error('network down') as never);
    await expect(poller.poll()).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });
});
