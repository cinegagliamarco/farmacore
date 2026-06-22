import { Test } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheck: jest.Mock;
  let pingCheck: jest.Mock;
  let amqp: { connected: boolean };

  beforeEach(async () => {
    // Mirror Terminus: the aggregate is 'error' (HTTP 503) iff some
    // indicator reports status 'down'. Without this, the mock returns 'ok'
    // unconditionally and the "stays ok when broker is down" test would
    // pass even if the controller regressed to gating on rabbitmq.
    healthCheck = jest
      .fn()
      .mockImplementation(async (checks: Array<() => Promise<unknown>>) => {
        const results = await Promise.all(checks.map((c) => c()));
        const info = Object.assign({}, ...results) as Record<
          string,
          { status: string }
        >;
        const down = Object.values(info).some((r) => r.status === 'down');
        return { status: down ? 'error' : 'ok', info };
      });
    pingCheck = jest.fn().mockResolvedValue({ postgres: { status: 'up' } });
    amqp = { connected: true };

    const mod = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check: healthCheck } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck } },
        { provide: AmqpConnection, useValue: amqp },
      ],
    }).compile();
    controller = mod.get(HealthController);
  });

  it('returns up when Postgres + RabbitMQ are reachable', async () => {
    const out = await controller.check();
    expect(out.status).toBe('ok');
    expect(out.info?.postgres?.status).toBe('up');
    expect(out.info?.rabbitmq?.status).toBe('up');
    expect(out.info?.rabbitmq?.connected).toBe(true);
  });

  it('stays ok and reports rabbitmq disconnected when the broker is down', async () => {
    amqp.connected = false;
    const out = await controller.check();
    expect(out.status).toBe('ok');
    expect(out.info?.rabbitmq?.status).toBe('up');
    expect(out.info?.rabbitmq?.connected).toBe(false);
  });

  it('fails the check (503) when Postgres is down', async () => {
    pingCheck.mockResolvedValueOnce({ postgres: { status: 'down' } });
    const out = await controller.check();
    expect(out.status).toBe('error');
  });
});
