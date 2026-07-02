import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { Registry } from 'prom-client';

export const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9091);

/**
 * Exposes a Prometheus scrape endpoint on :9091/metrics (Fly [metrics]).
 * OTLP remains trace-only; operational gauges live here.
 */
@Injectable()
export class PrometheusMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrometheusMetricsService.name);
  readonly registry = new Registry();
  private server?: Server;

  onModuleInit(): void {
    this.server = createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.statusCode = 404;
        res.end();
        return;
      }
      void this.registry.metrics().then((body) => {
        res.setHeader('Content-Type', this.registry.contentType);
        res.end(body);
      });
    });
    this.server.listen(METRICS_PORT, '0.0.0.0', () => {
      this.logger.log(`Prometheus metrics on :${METRICS_PORT}/metrics`);
    });
  }

  onModuleDestroy(): void {
    this.server?.close();
  }
}
