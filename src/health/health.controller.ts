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
 * Returns 200 + JSON when Postgres ping + AmqpConnection.connected
 * both hold; 503 + JSON when either is down so the orchestrator can
 * cycle the instance.
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
        rabbitmq: { status: this.amqp.connected ? 'up' : 'down' },
      }),
    ]);
  }
}
