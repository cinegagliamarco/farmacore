# Observability — Local smoke test

Run these to sanity-check the wiring before pointing a real vendor at it.

## 1. Dev default: OTel fully no-op

`.env.example` defaults `OTEL_DISABLED=1`, so the SDK never starts.

```bash
docker compose up -d postgres rabbitmq
npm run migration:run:app
npm run start:dev      # API
# (in another shell)
npm run start:worker   # worker
```

```bash
curl -s http://localhost:3000/health | jq
# Expect:
# {
#   "status": "ok",
#   "info": {
#     "postgres": { "status": "up" },
#     "rabbitmq": { "status": "up" }
#   },
#   "error": {},
#   "details": { ... }
# }
```

No spans should be exported, no OTel log lines should appear, no
errors logged. Stop both processes.

## 2. With a local OTLP collector (optional)

If you want to validate trace export end-to-end before deploy, run an
OTel collector locally and point the API at it:

```bash
docker run -d --name otel-collector -p 4318:4318 \
  -e "OTEL_LOG_LEVEL=debug" \
  otel/opentelemetry-collector:latest
```

```bash
OTEL_DISABLED=0 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=farmacore-api \
npm run start:dev
```

Hit `/health` a few times, then:

```bash
docker logs otel-collector | grep -i traces
```

Look for trace export batches. Tear down with:

```bash
docker rm -f otel-collector
```

## 3. Queue metrics against local RabbitMQ

The `rabbitmq:management` image in the dev compose stack exposes the
management API on port 15672 with `guest:guest`. The
`QueueMetricsPoller` works against it identically to CloudAMQP:

```bash
CLOUDAMQP_API_URL=http://localhost:15672/api \
CLOUDAMQP_API_USER=guest \
CLOUDAMQP_API_PASS=guest \
OTEL_DISABLED=0 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=farmacore-worker \
npm run start:worker
```

Worker logs should show no errors from `QueueMetricsPoller`, and the
collector should receive `pipeline.queue.depth` /
`pipeline.queue.oldest_age_seconds` metric points every ~30s.

Trigger a run to populate the queues:

```bash
# Use the admin endpoint (plan 06) once a tenant exists, or:
node -e "
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('./dist/app.module');
const {PipelinePublisher}=require('./dist/queue/pipeline-publisher.service');
(async()=>{
  const app=await NestFactory.createApplicationContext(AppModule);
  await app.get(PipelinePublisher).publishStart('acme', { reason: 'smoke' });
  await app.close();
})();
"
```

You should see `pipeline_queue_depth{queue=\"sync-base-product\"}`
spike then drain on the collector side.
