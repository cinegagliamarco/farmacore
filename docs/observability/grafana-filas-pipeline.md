# Grafana — board de filas e pipeline (Fly.io)

Plano de implementação para um dashboard operacional no **Grafana gerenciado do Fly** (`fly-metrics.net`) focado em filas RabbitMQ, execuções do pipeline, scrape de concorrentes e producers ativos.

Relacionado: [`dashboards.md`](./dashboards.md), [`../arquitetura-filas-pipeline.md`](../arquitetura-filas-pipeline.md).

---

## 1. Resposta curta

**Sim, é possível** montar um board com:

| Campo | Viável? | Como |
|-------|---------|------|
| Última execução (por fila / step) | Sim | Fila: consumers in-memory; step: poller **`pipeline_run`** (read-only) |
| **Duração da última execução** (ex.: `import-competitor-products.ikesaki` → 5h) | Sim | Gauge `pipeline_queue_last_duration_seconds` — wall-clock da onda (primeiro consume → fila esvaziada) |
| Produtos procurados / encontrados | Sim | Counters + gauges `pipeline_scrape_*` no `ImportCompetitorProductsStep` |
| Próxima execução (pipeline diário) | Sim | Gauge calculado no boot (`pipeline_next_daily_run_timestamp_seconds`) |
| **Producers produzindo agora** | Sim | Counter + gauge `pipeline_producer_last_publish_timestamp_seconds` no `PipelinePublisher` e crons |
| Profundidade / idade da fila | Sim | `QueueMetricsPoller` → Prometheus (API RMQ) |
| Runs em andamento | Sim | Gauge `pipeline_queue_run_in_progress` (in-memory) + `pipeline_run` com `status=running` (consulta) |
| Status/batches por step | Sim | Poller read-only em `core.pipeline_run` |
| Outbox pendente | Sim | `COUNT(*)` em `core.pipeline_outbox` (consulta) |

### Restrição: sem **persistir** métricas no Postgres

**Proibido:** gravar dados de observabilidade no banco — sem tabela `metrics_*`, sem colunas novas em `pipeline_run`, sem INSERT/UPDATE só para dashboard.

**Permitido:** **consultas read-only** às tabelas que já existem (`core.pipeline_run`, `core.pipeline_outbox`, etc.). Pollers periódicos que fazem `SELECT` e expõem o resultado como gauge Prometheus são OK.

| Fonte | Persistir métrica? | Consultar? |
|-------|-------------------|------------|
| `core.pipeline_run` | Não | **Sim** — última execução, status, batches, duração dispatch |
| `core.pipeline_outbox` | Não | **Sim** — fila pendente, attempts altos |
| Instrumentação inline | N/A (→ Prometheus) | — |
| Estado in-memory (worker) | Não | — |
| RabbitMQ Management API | Não | **Sim** (HTTP, não Postgres) |
| Prometheus/Fly | N/A (TSDB gerenciado) | — |

Fluxo de dados para o Grafana:

1. **Instrumentação inline** — consumers/publishers → gauges/counters/histograms
2. **Estado in-memory** — ondas por fila, producers ativos (tempo real; perdido no restart)
3. **Pollers read-only** — Postgres + RMQ API → gauges Prometheus
4. **Fly scrape** — `:9091/metrics` → Grafana

---

## 2. Contexto Fly.io

O Fly fornece, sem custo extra hoje:

- **Prometheus gerenciado** (VictoriaMetrics) — scrape a cada **15s**
- **Grafana gerenciado** em [fly-metrics.net](https://fly-metrics.net) com datasource Prometheus já configurado
- Retenção ~**15 dias** (monitoramento operacional)

### Como expor métricas customizadas

```toml
[metrics]
  port = 9091
  path = "/metrics"
```

O scraper do Fly **não consome OTLP**. Métricas operacionais precisam de endpoint **Prometheus** (`prom-client`).

**Recomendação:** manter OTLP só para traces; métricas de fila/pipeline via Prometheus/Fly.

### Apps envolvidos

| App Fly | Papel | Métricas |
|---------|-------|----------|
| `farmacore-worker` | Consome filas | **Principal** — duração, scrape, consumer in-flight |
| `farmacore-api` | Crons, outbox, HTTP | Producers (cron, admin, outbox, pricing) |
| `farmacore-broker` | RabbitMQ | Taxas publish/deliver via Management API (poller) |

---

## 3. Estado atual vs lacunas

### Já existe

| Artefato | O que mede |
|----------|------------|
| `QueueMetricsPoller` | depth + oldest age (OTel — migrar para Prometheus) |
| `withPipelineSpan` | Traces (não substitui gauges de duração no Grafana Fly) |
| Logs debug | `import-competitor-products[origin]: N scraped, M found` |

### Falta

1. Endpoint Prometheus + `[metrics]` no Fly
2. `PipelineMetricsRegistry` — estado in-memory por fila/producer
3. `PipelineRunMetricsPoller` — consultas read-only em `core.pipeline_run`
4. `OutboxMetricsPoller` — `COUNT` pendente em `core.pipeline_outbox`
5. Hooks nos consumers base (duração, in-progress)
6. Hooks no `PipelinePublisher` (producers ativos)
7. Métricas de scrape (procurados/encontrados)
8. Taxas RMQ (`publish_rate`, `deliver_rate`) no poller
9. Dashboard Grafana (JSON)

---

## 4. Arquitetura proposta

```
┌──────────────────┐   publish hooks    ┌─────────────────────────┐
│ farmacore-api    │ ─────────────────► │ PipelineMetricsRegistry │
│ crons / outbox   │                    │  (Map in-memory)        │
│ admin / pricing  │                    └───────────┬─────────────┘
└────────┬─────────┘                                │
         │ SELECT (read-only)                       │ prom-client gauges
         ▼                                          │
┌──────────────────┐   consume hooks                │
│ Postgres (Neon)  │ ◄── PipelineRunMetricsPoller   │
│ pipeline_run     │     OutboxMetricsPoller        ├──► :9091 /metrics
│ pipeline_outbox  │                                │
└──────────────────┘                                │
┌──────────────────┐                                │
│ farmacore-worker │ ───────────────────────────────┤
│ batch/dispatch   │                                │
└────────┬─────────┘                                │
         │                                         ▼
┌────────┴─────────┐   poll 30s              Fly scrape 15s
│ RMQ Management   │ ───────────────────────────────► Grafana
│ API (broker)     │
└──────────────────┘
```

### Componentes novos

| Módulo | Responsabilidade |
|--------|------------------|
| `PrometheusMetricsService` | Registry + HTTP `:9091/metrics` |
| `PipelineMetricsRegistry` | Maps in-memory; ondas por fila, producers ativos |
| `PipelineRunMetricsPoller` | `@Interval(60s)` — **SELECT** em `core.pipeline_run` → gauges step |
| `OutboxMetricsPoller` | `@Interval(30s)` — **COUNT** pendente + max attempts |
| `PipelinePublisher` (wrap) | Registra todo publish com label `producer` |
| Consumers base | Duração por fila, histogram batch, `run_in_progress` |
| `QueueMetricsPoller` (refactor) | Gauges Prometheus + taxas RMQ |
| `ImportCompetitorProductsStep` + dispatch | Scrape procurados/encontrados |

---

## 5. Catálogo de métricas

Prefixo: `pipeline_`. Labels reservados do Fly (`app`, `region`, `host`, `instance`) **não** redefinir.

### 5.1 Filas RabbitMQ (Management API)

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `pipeline_queue_depth` | Gauge | `queue` | Mensagens prontas |
| `pipeline_queue_oldest_age_seconds` | Gauge | `queue` | Idade da mensagem mais antiga |
| `pipeline_queue_consumers` | Gauge | `queue` | Consumidores conectados |
| `pipeline_queue_messages_unacked` | Gauge | `queue` | In-flight no broker |
| `pipeline_queue_publish_rate` | Gauge | `queue` | msg/s publicadas na fila (RMQ `message_stats.publish_details.rate`) |
| `pipeline_queue_deliver_rate` | Gauge | `queue` | msg/s entregues a consumers |
| `pipeline_queue_ack_rate` | Gauge | `queue` | msg/s confirmadas |

**Inferência “esta fila está sendo alimentada agora”** (sem saber o producer):

```metricsql
pipeline_queue_publish_rate{queue="import-competitor-products.ikesaki"} > 0
```

### 5.2 Última execução e duração por fila

Métricas centrais para painéis como **`import-competitor-products.ikesaki — 5h 12m`**.

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `pipeline_queue_last_started_timestamp_seconds` | Gauge | `queue`, `tenant` | Início da última onda completada (ou em curso) |
| `pipeline_queue_last_finished_timestamp_seconds` | Gauge | `queue`, `tenant` | Fim da última onda |
| `pipeline_queue_last_duration_seconds` | Gauge | `queue`, `tenant` | `finished - started` em segundos (ex.: `18000` = 5h) |
| `pipeline_queue_run_in_progress` | Gauge | `queue`, `tenant` | `1` enquanto a onda está ativa |
| `pipeline_queue_last_status` | Gauge | `queue`, `tenant`, `status` | `1` em `completed` \| `failed` \| `running` |
| `pipeline_queue_batches_last_total` | Gauge | `queue`, `tenant` | Mensagens/batches processados na última onda |
| `pipeline_queue_batches_last_done` | Gauge | `queue`, `tenant` | Concluídos na onda atual (atualizado a cada ACK) |

#### O que é uma “onda” por fila

Para filas de scrape por origem (`import-competitor-products.ikesaki`):

1. **Início:** worker consome a **primeira** mensagem após idle (fila estava vazia + `run_in_progress=0`, ou gap > `IDLE_GAP_SECONDS`)
2. **Durante:** cada batch incrementa `batches_last_done`; `run_in_progress=1`
3. **Fim:** último batch da onda completa **e** `pipeline_queue_depth{queue}=0` **e** `messages_unacked=0`
4. **Grava:** `last_duration_seconds = now - started_at`

Para filas `.dispatch` (1 msg/run): duração = tempo do `process()` do dispatcher.

Para filas `.batch` compartilhadas: mesma lógica de onda (vários batches = uma onda até esvaziar).

Constante sugerida: `IDLE_GAP_SECONDS = 300` (5 min) — evita fundir duas execuções distantes na mesma onda.

#### Estado in-memory (`PipelineMetricsRegistry`)

```typescript
interface QueueWaveState {
  tenant: string;
  queue: string;
  startedAtMs: number;
  batchesDone: number;
  batchesTotalHint: number; // opcional: set no dispatch publish count por origem
  inFlightLocal: number;    // batches sendo processados neste worker
  status: 'running' | 'completed' | 'failed';
}
// chave: `${tenant}:${queue}` — ~ tenants × ~40 filas, trivial
```

**Restart do worker:** estado in-memory zera; gauges Prometheus ficam stale até próxima onda. `run_in_progress` pode ficar `1` — expirar com gauge auxiliar `pipeline_queue_run_stale_seconds` ou reset no boot.

### 5.3 Duração por batch (distribuição)

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `pipeline_consumer_batch_duration_seconds` | Histogram | `queue`, `tenant` | Tempo de `handle()` por mensagem |
| `pipeline_consumer_messages_total` | Counter | `queue`, `tenant`, `result` | `ok` \| `skip` \| `fail` |

Buckets sugeridos para scrape longo: `[1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600]`.

Painel: p50/p95 de `import-competitor-products.drogal` explica por que a onda total leva 5h.

### 5.4 Producers (quem publica agora)

Todo publish AMQP passa por **`PipelinePublisher.publishStep`** / `publishStart` / `publishSingleStep` — ponto único de instrumentação.

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `pipeline_producer_messages_published_total` | Counter | `producer`, `tenant`, `target_queue` | Total publicado |
| `pipeline_producer_last_publish_timestamp_seconds` | Gauge | `producer`, `tenant`, `target_queue` | Unix ts da última publicação |
| `pipeline_producer_last_batch_count` | Gauge | `producer`, `tenant`, `target_queue` | Msgs publicadas no último burst (ex.: dispatch emitiu 1500) |
| `pipeline_producer_active` | Gauge | `producer`, `tenant` | `1` se publicou nos últimos **120s** |

#### Catálogo de producers (`producer` label)

| `producer` | Origem no código | Publica em |
|------------|------------------|------------|
| `cron:daily-pipeline` | `DailyPipelineCron` | `{tenant}.pipeline.start` |
| `cron:pricing-schedule` | `PricingScheduleCron` | outbox → `apply-price.dispatch` |
| `outbox` | `OutboxPublisher` | routing key da row (successors) |
| `admin:pipeline-start` | `AdminPipelineService.startForTenant` | `pipeline.start` |
| `admin:trigger-step` | `AdminPipelineService.triggerStep` | step/dispatch isolado |
| `pipeline-start` | `PipelineStartConsumer` | 2 ramos iniciais |
| `dispatch:sync-base-product` | `DispatchPipelineConsumer` | `.batch` |
| `dispatch:import-competitor-products` | idem | `.drogal`, `.ikesaki`, … |
| `dispatch:*` | demais dispatchers | filas batch/origem |
| `consumer:successor` | `BasePipelineConsumer` (v1) | successors direto AMQP |
| `pricing:apply` | `PricingApplyService` | outbox dispatch |

**“Produzindo agora”** — duas definições complementares no dashboard:

```metricsql
# Producer publicou nos últimos 2 min
(time() - pipeline_producer_last_publish_timestamp_seconds) < 120

# Ou taxa > 0
rate(pipeline_producer_messages_published_total[1m]) > 0
```

Tabela de producers ativos:

| Producer | Tenant | Fila alvo | Última pub | Msg/min |
|----------|--------|-----------|------------|---------|
| `dispatch:import-competitor-products` | acme | `import-competitor-products.ikesaki` | 2 min atrás | 847 |
| `outbox` | acme | `calc-base-product-metrics.dispatch` | 8 s atrás | 12 |

### 5.5 Scrape (procurados / encontrados)

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `pipeline_scrape_eans_total` | Counter | `tenant`, `origin` | EANs enviados ao scraper |
| `pipeline_scrape_found_total` | Counter | `tenant`, `origin` | EANs com `found: true` |
| `pipeline_scrape_errors_total` | Counter | `tenant`, `origin` | EANs com erro |
| `pipeline_scrape_last_eans` | Gauge | `tenant`, `origin` | Planejados na última onda (reset no dispatch) |
| `pipeline_scrape_last_found` | Gauge | `tenant`, `origin` | Encontrados na última onda (acumula por batch) |
| `pipeline_scrape_wave_duration_seconds` | Gauge | `tenant`, `origin` | Duração da onda de scrape por origem (= `queue_last_duration` da fila correspondente) |

Dispatch seta `pipeline_scrape_last_eans`; cada batch incrementa `pipeline_scrape_last_found`.

### 5.6 Agendamento e outbox

| Métrica | Tipo | Labels | Fonte | Descrição |
|---------|------|--------|-------|-----------|
| `pipeline_next_daily_run_timestamp_seconds` | Gauge | — | código (cron) | Próximo `00:00 UTC` |
| `pipeline_daily_last_published_timestamp_seconds` | Gauge | — | `DailyPipelineCron` | Último `publishStart` |
| `pipeline_outbox_pending` | Gauge | — | **SELECT** outbox | Rows com `published_at IS NULL` |
| `pipeline_outbox_max_attempts` | Gauge | — | **SELECT** outbox | `MAX(attempts)` entre pendentes |
| `pipeline_outbox_oldest_pending_age_seconds` | Gauge | — | **SELECT** outbox | Idade da row pendente mais antiga |
| `pipeline_outbox_drain_batch_size` | Gauge | — | in-memory | Msgs drenadas no último tick |

**Query outbox (poller — read-only):**

```sql
SELECT
  count(*) FILTER (WHERE published_at IS NULL) AS pending,
  coalesce(max(attempts) FILTER (WHERE published_at IS NULL), 0) AS max_attempts,
  coalesce(
    extract(epoch FROM (now() - min(created_at) FILTER (WHERE published_at IS NULL))),
    0
  ) AS oldest_pending_age_seconds
FROM core.pipeline_outbox;
```

### 5.7 Step lógico — consulta `pipeline_run` (read-only)

Poller preferencial para status/batches/duração de **dispatch** (`batch_seq = 0`). Complementa (não substitui) a duração por fila física da §5.2 — filas `.ikesaki` etc. continuam no registry in-memory.

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `pipeline_step_last_started_timestamp_seconds` | Gauge | `tenant`, `step` | `started_at` do último dispatch |
| `pipeline_step_last_finished_timestamp_seconds` | Gauge | `tenant`, `step` | `finished_at` |
| `pipeline_step_last_duration_seconds` | Gauge | `tenant`, `step` | `finished_at - started_at` (segundos) |
| `pipeline_step_last_status` | Gauge | `tenant`, `step`, `status` | `1` na combinação ativa |
| `pipeline_step_last_batches_planned` | Gauge | `tenant`, `step` | `batches_planned` |
| `pipeline_step_last_batches_done` | Gauge | `tenant`, `step` | `batches_done` |
| `pipeline_step_running` | Gauge | `tenant`, `step` | `1` se último dispatch `status=running` |

**Query Postgres (poller — read-only):**

```sql
SELECT DISTINCT ON (tenant_id, step)
  tenant_id,
  step,
  status,
  batches_planned,
  batches_done,
  extract(epoch FROM started_at)  AS started_ts,
  extract(epoch FROM finished_at) AS finished_ts,
  CASE
    WHEN finished_at IS NOT NULL AND started_at IS NOT NULL
    THEN extract(epoch FROM (finished_at - started_at))
    ELSE NULL
  END AS duration_seconds
FROM core.pipeline_run
WHERE batch_seq = 0
ORDER BY tenant_id, step, started_at DESC;
```

**Quando usar Postgres vs in-memory:**

| Pergunta | Fonte preferida | Por quê |
|----------|-----------------|---------|
| Duração de `import-competitor-products.ikesaki` | In-memory (§5.2) | `pipeline_run` não tem row por fila de origem |
| Status/batches do step `import-competitor-products` | Postgres (§5.7) | fan-in centralizado no dispatch row |
| Duração do dispatch `sync-base-product` | Postgres | 1 row = 1 execução |
| Producer ativo agora | In-memory (§5.4) | não existe coluna equivalente |
| Outbox pendente | Postgres (§5.6) | fonte de verdade |

**Run em andamento (cross-check):** `pipeline_step_running==1` (Postgres) + `pipeline_queue_run_in_progress==1` (in-memory) — divergência indica worker crash ou dispatch travado.

---

## 6. Implementação no código

### 6.1 Dependência

```bash
npm install prom-client
```

### 6.2 `PipelineMetricsRegistry`

Arquivo: `src/observability/pipeline-metrics.registry.ts`

Responsabilidades:

- Singleton injectable (`ObservabilityModule`)
- Maps: `queueWaves`, `producerLastPublish`
- Métodos:
  - `onPublish(producer, tenant, targetQueue, count?)`
  - `onConsumeStart(tenant, queue)`
  - `onConsumeEnd(tenant, queue, result, durationSec)`
  - `onDispatchBatches(tenant, step, targetQueues, countsPerQueue)`
  - `refreshDerivedGauges()` — recalcula `producer_active`, expira `run_in_progress` stale

### 6.3 Hooks nos consumers base

**`BatchPipelineConsumer.process()`** (e equivalente v1/dispatch):

```typescript
// início do process (após idempotency skip)
metrics.onConsumeStart(message.tenantId, physicalQueueName);
const t0 = Date.now();
try {
  await /* handle */;
  metrics.onConsumeEnd(tenant, queue, 'ok', (Date.now()-t0)/1000);
} catch {
  metrics.onConsumeEnd(tenant, queue, 'fail', ...);
}
```

`physicalQueueName` vem do decorator `@RabbitSubscribe({ queue })` — expor como `protected readonly queueName` na subclass ou constante compartilhada.

**`DispatchPipelineConsumer`** — após publicar batches:

```typescript
metrics.onDispatchBatches(tenant, step, batches grouped by queue);
for (const b of batches) {
  await publisher.publishStep(b, ..., { producer: `dispatch:${step}` });
}
```

### 6.4 Hook no `PipelinePublisher`

```typescript
public async publishStep(msg, timeoutMs?, meta?: { producer: string }) {
  await this.amqp.publish(...);
  metrics.onPublish(meta?.producer ?? 'unknown', msg.tenantId, msg.queue ?? msg.step);
}
```

Crons passam `producer: 'cron:daily-pipeline'` etc.

### 6.5 `PipelineRunMetricsPoller` e `OutboxMetricsPoller`

Arquivos: `src/observability/pipeline-run-metrics.poller.ts`, `outbox-metrics.poller.ts`

- `@Interval(60_000)` / `@Interval(30_000)` respectivamente
- Apenas `SELECT` / `COUNT` — **nunca** INSERT/UPDATE
- Rodar na **API** (já tem cron/outbox) e opcionalmente no worker
- Índices existentes em `pipeline_run` (`tenant_id, step, started_at`) e outbox parcial pendente — queries leves

### 6.6 `QueueMetricsPoller` — taxas RMQ

Estender parse da API `/api/queues`:

```typescript
interface QueueInfo {
  name: string;
  messages: number;
  messages_unacknowledged?: number;
  consumers?: number;
  head_message_timestamp?: number | null;
  message_stats?: {
    publish_details?: { rate: number };
    deliver_get_details?: { rate: number };
    ack_details?: { rate: number };
  };
}
```

### 6.7 `fly.toml`

```toml
[metrics]
  port = 9091
  path = "/metrics"
```

Em `fly.worker.toml` e `fly.api.toml`.

### 6.8 Cardinalidade

| Permitido | Evitar |
|-----------|--------|
| `tenant` | `pipeline_run_id` |
| `queue` (~40) | `batch_seq` |
| `origin` (9) | `ean` |
| `producer` (~20 valores fixos) | routing keys dinâmicas como label |

---

## 7. Dashboard Grafana — “Farmacore · Filas & Pipeline”

JSON versionado em `docs/observability/grafana/filas-pipeline.dashboard.json` (quando implementado).

### 7.1 Variáveis

| Nome | Tipo | Query / valores |
|------|------|-----------------|
| `tenant` | Query | `label_values(pipeline_queue_last_duration_seconds, tenant)` |
| `queue` | Query | `label_values(pipeline_queue_depth, queue)` |
| `origin` | Custom | `drogal`, `drogasil`, `ikesaki`, … |
| `producer` | Query | `label_values(pipeline_producer_messages_published_total, producer)` |

### 7.2 Layout (rows)

#### Row A — Resumo operacional

| Painel | Tipo | Query / lógica |
|--------|------|----------------|
| Próxima execução diária | Stat (countdown) | `pipeline_next_daily_run_timestamp_seconds - time()` |
| Último pipeline.start | Stat (time ago) | `time() - pipeline_daily_last_published_timestamp_seconds` |
| Filas com run ativo | Stat | `sum(pipeline_queue_run_in_progress)` |
| Producers ativos | Stat | `sum(pipeline_producer_active)` |
| Outbox pendente | Stat | `pipeline_outbox_pending` — alerta se > 0 |
| DLQ total | Stat | `sum(pipeline_queue_depth{queue=~".+\\.dlq"})` |

#### Row B — Saúde das filas (tempo real)

| Painel | Tipo | Query |
|--------|------|-------|
| Profundidade | Time series | `pipeline_queue_depth{queue=~"$queue"}` |
| Idade mensagem mais antiga | Time series | `pipeline_queue_oldest_age_seconds` |
| Unacked (in-flight broker) | Time series | `pipeline_queue_messages_unacked` |
| Filas com backlog > 100 | Table | `pipeline_queue_depth > 100` |
| DLQ | Bar gauge | `pipeline_queue_depth{queue=~".+\\.dlq"}` |

#### Row C — **Duração da última execução por fila** ★

Tabela principal pedida pelo operador.

| Painel | Tipo | Colunas / query |
|--------|------|-----------------|
| **Última execução por fila** | Table | ver abaixo |
| Top 10 filas mais lentas | Bar gauge | `topk_max(10, pipeline_queue_last_duration_seconds{tenant="$tenant"})` |
| Duração histórica | Time series | `pipeline_queue_last_duration_seconds` (step changes on new wave) |
| Em execução agora | Table | `pipeline_queue_run_in_progress == 1` |

**Tabela “Última execução por fila”** — queries por coluna:

| Coluna | Query MetricsQL | Formato Grafana |
|--------|-----------------|-----------------|
| Fila | label `queue` | text |
| Tenant | label `tenant` | text |
| Duração | `pipeline_queue_last_duration_seconds` | **`duration`** → exibe `5h 12m` |
| Terminou em | `pipeline_queue_last_finished_timestamp_seconds` | datetime |
| Há quanto tempo | `time() - pipeline_queue_last_finished_timestamp_seconds` | duration ago |
| Status | `pipeline_step_last_status` ou `pipeline_queue_last_status` | mapping |
| Batches | `done / total` gauges | `1234/1234` |
| Em curso? | `pipeline_queue_run_in_progress` | yes/no |

Exemplo de linha:

```text
import-competitor-products.ikesaki | acme | 5h 12m | 2026-07-01 05:48 UTC | 3h ago | completed | 4200/4200 | —
import-competitor-products.drogal   | acme | 2h 03m | 2026-07-01 08:57 UTC | 12m ago | completed | 8500/8500 | —
sync-base-product.batch             | acme | 4m 30s | ...                  | ...      | completed | 72/72     | —
```

Filtro rápido scrape:

```metricsql
pipeline_queue_last_duration_seconds{
  tenant="$tenant",
  queue=~"import-competitor-products\\..+"
}
```

#### Row D — **Producers produzindo agora** ★

| Painel | Tipo | Query |
|--------|------|-------|
| **Producers ativos** | Table | `pipeline_producer_active == 1` + join last_publish + rate |
| Taxa publish por producer | Time series | `sum by (producer) (rate(pipeline_producer_messages_published_total[1m]))` |
| Taxa publish por fila (RMQ) | Time series | `pipeline_queue_publish_rate{queue=~"$queue"}` |
| Burst size último dispatch | Bar chart | `pipeline_producer_last_batch_count{producer=~"dispatch:.*"}` |
| Outbox drenando | Stat | `rate(...{producer="outbox"}[1m])` |

**Tabela producers ativos:**

| Coluna | Query |
|--------|-------|
| Producer | label `producer` |
| Tenant | label `tenant` |
| Fila alvo | label `target_queue` |
| Última publicação | `pipeline_producer_last_publish_timestamp_seconds` → relative |
| Msg/min | `rate(pipeline_producer_messages_published_total[1m]) * 60` |
| Ativo | `pipeline_producer_active` |

Destaque visual: linhas com `rate > 0` → verde; idle > 10 min → cinza.

#### Row E — Throughput consume vs produce (ETA)

| Painel | Tipo | Query |
|--------|------|-------|
| Publish vs Deliver rate | Time series (dual) | `pipeline_queue_publish_rate` vs `pipeline_queue_deliver_rate` |
| ETA esvaziar fila | Stat | `pipeline_queue_depth / pipeline_queue_deliver_rate` (segundos) |
| Progresso onda atual | Gauge | `pipeline_queue_batches_last_done / pipeline_queue_batches_last_total` |
| Consumer p95 batch | Time series | `histogram_quantile(0.95, pipeline_consumer_batch_duration_seconds)` |

#### Row F — Scrape concorrentes (`$tenant`)

| Painel | Tipo | Query |
|--------|------|-------|
| EANs procurados (última onda) | Table | `pipeline_scrape_last_eans` by `origin` |
| EANs encontrados | Table | `pipeline_scrape_last_found` |
| Taxa acerto | Bar gauge | `found / eans` |
| Duração por origem | Table | `pipeline_scrape_wave_duration_seconds` (= fila `.origin`) |
| Throughput scrape | Time series | `rate(pipeline_scrape_eans_total[5m])` by origin |

#### Row G — Steps lógicos (Postgres → Prometheus)

| Painel | Tipo | Query |
|--------|------|-------|
| Tabela steps (tenant) | Table | `pipeline_step_last_*` — started, finished, **duration**, status, batches |
| Duração último dispatch | Bar gauge | `pipeline_step_last_duration_seconds{tenant="$tenant"}` |
| Progresso fan-in | Gauge | `batches_done / batches_planned` |
| Steps running agora | Table | `pipeline_step_running == 1` |
| Steps com falha | Stat | `pipeline_step_last_status{status="failed"} == 1` |
| Outbox preso | Stat + table | `pipeline_outbox_pending`, `pipeline_outbox_max_attempts` |

#### Row H — Consumer health

| Painel | Tipo | Query |
|--------|------|-------|
| Msgs processadas/min | Time series | `sum by (queue) (rate(pipeline_consumer_messages_total{result="ok"}[1m]))` |
| Falhas/min | Time series | `rate(...{result="fail"}[1m])` |
| Skips (idempotência) | Time series | `rate(...{result="skip"}[1m])` |
| p99 batch duration (scrape) | Heatmap | histogram por filas `import-competitor-products.*` |

### 7.3 Queries MetricsQL de referência

```metricsql
# Duração última execução Ikesaki (5h = 18000s)
pipeline_queue_last_duration_seconds{
  tenant="acme",
  queue="import-competitor-products.ikesaki"
}

# Filas scrape ordenadas por duração
sort_desc(pipeline_queue_last_duration_seconds{
  tenant="acme",
  queue=~"import-competitor-products\\..+"
})

# Producers ativos agora
pipeline_producer_active == 1

# Dispatch alimentando Ikesaki neste minuto
rate(pipeline_producer_messages_published_total{
  producer="dispatch:import-competitor-products",
  target_queue="import-competitor-products.ikesaki"
}[1m]) > 0

# Fila em execução (onda aberta)
pipeline_queue_run_in_progress{queue=~"import-competitor-products\\..+"} == 1

# ETA para esvaziar (cuidado: deliver_rate=0 → Inf)
pipeline_queue_depth / pipeline_queue_deliver_rate

# Onda de scrape: quanto falta
1 - (
  pipeline_queue_batches_last_done
  / pipeline_queue_batches_last_total
)
# Step duration (Postgres poller)
pipeline_step_last_duration_seconds{tenant="acme", step="import-competitor-products"}

# Outbox
pipeline_outbox_pending
```

### 7.4 Transformações Grafana (tabela duração humana)

Na coluna “Duração”, usar **Standard options → Unit → duration (s)** sobre `pipeline_queue_last_duration_seconds`. Grafana renderiza automaticamente `5h 12m 30s`.

Para “há quanto tempo terminou”: unit **duration (s)** em `time() - last_finished_timestamp_seconds` com **Custom → reverse** ou usar **dateTimeFromNow** no timestamp.

---

## 8. Alertas sugeridos

| Alerta | Condição | Severidade |
|--------|----------|------------|
| DLQ não vazia | `pipeline_queue_depth{queue=~".+\\.dlq"} > 0` 5m | critical |
| Fila scrape > 4h sem progresso | `pipeline_queue_run_in_progress==1` AND `increase(batches_last_done[30m])==0` | warning |
| Duração scrape anormal | `pipeline_queue_last_duration_seconds{queue=~".+ikesaki.+"} > 21600` (6h) | warning |
| Producer dispatch parado com backlog | `pipeline_queue_depth > 500` AND `pipeline_queue_deliver_rate == 0` 10m | critical |
| Pipeline diário não rodou | `time() - pipeline_daily_last_published_timestamp_seconds > 90000` | critical |
| Outbox pendente | `pipeline_outbox_pending > 100` por 5m | critical |
| Outbox attempts alto | `pipeline_outbox_max_attempts > 10` | warning |
| Taxa de falha consumer | `rate(pipeline_consumer_messages_total{result="fail"}[5m]) > 0.1` | warning |

---

## 9. Fases de rollout

### Fase 1 — Infra Prometheus (1–2 dias)

- [ ] `prom-client` + `:9091` worker/API
- [ ] `[metrics]` Fly
- [ ] `QueueMetricsPoller` → Prometheus + taxas publish/deliver/ack
- [ ] Row B dashboard

### Fase 2 — Pollers Postgres read-only (0,5–1 dia)

- [ ] `PipelineRunMetricsPoller` + `OutboxMetricsPoller`
- [ ] Row A (outbox) + Row G

### Fase 3 — Duração por fila + runs ativos (1–2 dias)

- [ ] `PipelineMetricsRegistry` + hooks consumers base
- [ ] Gauges `last_duration`, `run_in_progress`, histogram batch
- [ ] Row C + E (parcial) + H

### Fase 4 — Producers (1 dia)

- [ ] Instrumentar `PipelinePublisher` + crons + outbox
- [ ] Row D + painéis publish vs deliver

### Fase 5 — Scrape stats (1 dia)

- [ ] Counters/gauges `ImportCompetitorProductsStep` + dispatch
- [ ] Row F

### Fase 6 — Agendamento + polish

- [ ] Gauges cron
- [ ] Row A + alertas
- [ ] Export JSON dashboard
- [ ] Atualizar [`dashboards.md`](./dashboards.md)

---

## 10. Limitações

| Limitação | Impacto | Mitigação |
|-----------|---------|-----------|
| Restart worker zera ondas in-memory | `run_in_progress` / duração por fila stale | Postgres §5.7 cobre step; expirar gauge stale após 1h |
| Retenção Fly 15 dias | Sem histórico longo no TSDB | Consultas Postgres para “último run” sempre frescas; histórico longo → federar Prometheus ou Grafana+Postgres externo |
| Duração por fila de origem | Não está em `pipeline_run` | Registry in-memory §5.2 (única opção sem schema novo) |
| `pipeline_run_id` no Grafana | Alta cardinalidade como label | Drill-down via logs/traces OTLP ou query SQL ad-hoc |
| Multi-réplica worker | Maps locais duplicados | Agregar com `max()` (timestamps) ou `sum()` (counters) por `tenant`+`queue` |
| Pollers Postgres | +1 query/min no Neon | Queries indexadas, intervalo 60s, só API |

---

## 11. Checklist pós-deploy

```bash
TOKEN=$(flyctl auth token)
ORG=<org-slug>

# Duração por fila visível?
curl -s "https://api.fly.io/prometheus/$ORG/api/v1/query" \
  --data-urlencode 'query=pipeline_queue_last_duration_seconds{queue=~"import-competitor-products.*"}' \
  -H "Authorization: Bearer $TOKEN" | jq .

# Producers ativos?
curl -s "https://api.fly.io/prometheus/$ORG/api/v1/query" \
  --data-urlencode 'query=pipeline_producer_active' \
  -H "Authorization: Bearer $TOKEN" | jq .

# Endpoint local
curl -s localhost:9091/metrics | grep -E 'pipeline_queue_last_duration|pipeline_producer_active'
```

Validação manual após um pipeline diário:

1. Row C — `import-competitor-products.ikesaki` mostra duração coerente (~horas para catálogo grande)
2. Row G — status/batches do step batem com `SELECT ... FROM core.pipeline_run WHERE batch_seq=0`
3. Row D — durante dispatch, `dispatch:import-competitor-products` aparece ativo
4. Row E — `deliver_rate > 0` enquanto depth decresce
5. Ao terminar — `run_in_progress` volta a 0; `pipeline_step_last_status` → completed

---

## 12. Decisões fechadas

| # | Decisão |
|---|---------|
| 1 | **Sem gravar métricas no Postgres** — consultas read-only OK (`pipeline_run`, `pipeline_outbox`) |
| 2 | Duração por **fila física** via in-memory; duração/status de **step** via poller Postgres |
| 3 | Producers identificados por label fixo `producer` no `PipelinePublisher` |
| 4 | “Produzindo agora” = publish nos últimos **120s** ou `rate[1m] > 0` |
| 5 | OTLP mantido para traces; métricas operacionais via Prometheus/Fly |

---

*Implementado no código — ver `src/observability/` e dashboard em `docs/observability/grafana/`.*
