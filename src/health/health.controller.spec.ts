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
    healthCheck = jest
      .fn()
      .mockImplementation(async (checks: Array<() => Promise<unknown>>) => {
        const results = await Promise.all(checks.map((c) => c()));
        return { status: 'ok', info: Object.assign({}, ...results) };
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
  });

  it('reports rabbitmq down when AmqpConnection.connected is false', async () => {
    amqp.connected = false;
    const out = await controller.check();
    expect(out.info?.rabbitmq?.status).toBe('down');
  });
});
