import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Public } from '../auth/decorators/public.decorator';

/**
 * /health is what Fly's healthcheck and Better Stack uptime hit.
 * Gates only on Postgres (every route needs it): 200 when it pings, 503
 * when it doesn't. RabbitMQ is reported via `connected` but never fails
 * the check — a broker outage must not pull the API out of Fly's rotation
 * when most of the surface doesn't need the broker. `status` is forced
 * 'up' because Terminus derives the HTTP code from it; the real broker
 * state is in `connected`, which is what monitoring should alert on.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly amqp: AmqpConnection,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  public check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('postgres', { timeout: 1500 }),
      (): HealthIndicatorResult => ({
        rabbitmq: { status: 'up', connected: this.amqp.connected },
      }),
    ]);
  }
}
