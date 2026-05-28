import { Test } from '@nestjs/testing';
import { QueueMetricsPoller } from './queue-metrics.poller';
import { AppConfigService } from '../config/app-config.service';

describe('QueueMetricsPoller', () => {
  let poller: QueueMetricsPoller;
  let configValue: {
    cloudamqp: { apiUrl?: string; user?: string; pass?: string };
  };

  beforeEach(async () => {
    configValue = { cloudamqp: {} };
    const mod = await Test.createTestingModule({
      providers: [
        QueueMetricsPoller,
        { provide: AppConfigService, useValue: configValue },
      ],
    }).compile();
    poller = mod.get(QueueMetricsPoller);
  });

  it('does nothing when CLOUDAMQP_API_URL is not set', async () => {
    await expect(poller.poll()).resolves.toBeUndefined();
  });

  it('parses queue list into this.last', async () => {
    configValue.cloudamqp = { apiUrl: 'https://x/api', user: 'u', pass: 'p' };
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
    configValue.cloudamqp = { apiUrl: 'https://x/api', user: 'u', pass: 'p' };
    const fetchSpy = jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValue(new Error('network down') as never);
    await expect(poller.poll()).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });
});
