import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Counter, Gauge, Histogram } from 'prom-client';
import { PrometheusMetricsService } from './prometheus-metrics.service';

const IDLE_GAP_SECONDS = 300;
const PRODUCER_ACTIVE_SECONDS = 120;
const STALE_RUN_SECONDS = 3600;
const QUEUE_STATUSES = ['completed', 'failed', 'running'] as const;
const STEP_STATUSES = ['completed', 'failed', 'running'] as const;

export interface RmqQueueSnapshot {
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

interface QueueWaveState {
  tenant: string;
  queue: string;
  startedAtMs: number;
  batchesDone: number;
  batchesTotalHint: number;
  inFlightLocal: number;
  status: 'running' | 'completed' | 'failed';
  lastActivityMs: number;
}

interface ProducerState {
  producer: string;
  tenant: string;
  targetQueue: string;
  lastPublishMs: number;
  lastBatchCount: number;
}

@Injectable()
export class PipelineMetricsRegistry implements OnModuleInit {
  private readonly logger = new Logger(PipelineMetricsRegistry.name);
  private readonly queueWaves = new Map<string, QueueWaveState>();
  private readonly producers = new Map<string, ProducerState>();
  private readonly rmqByQueue = new Map<string, RmqQueueSnapshot>();
  private readonly scrapeLastFoundAcc = new Map<string, number>();

  private readonly queueDepth: Gauge;
  private readonly queueOldestAge: Gauge;
  private readonly queueConsumers: Gauge;
  private readonly queueUnacked: Gauge;
  private readonly queuePublishRate: Gauge;
  private readonly queueDeliverRate: Gauge;
  private readonly queueAckRate: Gauge;

  private readonly queueLastStarted: Gauge;
  private readonly queueLastFinished: Gauge;
  private readonly queueLastDuration: Gauge;
  private readonly queueRunInProgress: Gauge;
  private readonly queueLastStatus: Gauge;
  private readonly queueBatchesLastTotal: Gauge;
  private readonly queueBatchesLastDone: Gauge;

  private readonly consumerBatchDuration: Histogram;
  private readonly consumerMessages: Counter;

  private readonly producerPublished: Counter;
  private readonly producerLastPublish: Gauge;
  private readonly producerLastBatchCount: Gauge;
  private readonly producerActive: Gauge;

  private readonly scrapeEansTotal: Counter;
  private readonly scrapeFoundTotal: Counter;
  private readonly scrapeErrorsTotal: Counter;
  private readonly scrapeLastEans: Gauge;
  private readonly scrapeLastFound: Gauge;
  private readonly scrapeWaveDuration: Gauge;

  private readonly nextDailyRun: Gauge;
  private readonly dailyLastPublished: Gauge;
  private readonly outboxPending: Gauge;
  private readonly outboxMaxAttempts: Gauge;
  private readonly outboxOldestPendingAge: Gauge;
  private readonly outboxDrainBatch: Gauge;

  private readonly stepLastStarted: Gauge;
  private readonly stepLastFinished: Gauge;
  private readonly stepLastDuration: Gauge;
  private readonly stepLastStatus: Gauge;
  private readonly stepLastBatchesPlanned: Gauge;
  private readonly stepLastBatchesDone: Gauge;
  private readonly stepRunning: Gauge;

  constructor(prometheus: PrometheusMetricsService) {
    const reg = prometheus.registry;

    this.queueDepth = new Gauge({
      name: 'pipeline_queue_depth',
      help: 'Messages ready in the queue',
      labelNames: ['queue'],
      registers: [reg],
    });
    this.queueOldestAge = new Gauge({
      name: 'pipeline_queue_oldest_age_seconds',
      help: 'Age of the oldest message in seconds',
      labelNames: ['queue'],
      registers: [reg],
    });
    this.queueConsumers = new Gauge({
      name: 'pipeline_queue_consumers',
      help: 'Consumers connected to the queue',
      labelNames: ['queue'],
      registers: [reg],
    });
    this.queueUnacked = new Gauge({
      name: 'pipeline_queue_messages_unacked',
      help: 'In-flight messages on the broker',
      labelNames: ['queue'],
      registers: [reg],
    });
    this.queuePublishRate = new Gauge({
      name: 'pipeline_queue_publish_rate',
      help: 'Messages published per second',
      labelNames: ['queue'],
      registers: [reg],
    });
    this.queueDeliverRate = new Gauge({
      name: 'pipeline_queue_deliver_rate',
      help: 'Messages delivered per second',
      labelNames: ['queue'],
      registers: [reg],
    });
    this.queueAckRate = new Gauge({
      name: 'pipeline_queue_ack_rate',
      help: 'Messages acked per second',
      labelNames: ['queue'],
      registers: [reg],
    });

    this.queueLastStarted = new Gauge({
      name: 'pipeline_queue_last_started_timestamp_seconds',
      help: 'Start of the last queue wave',
      labelNames: ['tenant', 'queue'],
      registers: [reg],
    });
    this.queueLastFinished = new Gauge({
      name: 'pipeline_queue_last_finished_timestamp_seconds',
      help: 'End of the last queue wave',
      labelNames: ['tenant', 'queue'],
      registers: [reg],
    });
    this.queueLastDuration = new Gauge({
      name: 'pipeline_queue_last_duration_seconds',
      help: 'Duration of the last queue wave',
      labelNames: ['tenant', 'queue'],
      registers: [reg],
    });
    this.queueRunInProgress = new Gauge({
      name: 'pipeline_queue_run_in_progress',
      help: '1 while a queue wave is active',
      labelNames: ['tenant', 'queue'],
      registers: [reg],
    });
    this.queueLastStatus = new Gauge({
      name: 'pipeline_queue_last_status',
      help: 'Status of the last queue wave',
      labelNames: ['tenant', 'queue', 'status'],
      registers: [reg],
    });
    this.queueBatchesLastTotal = new Gauge({
      name: 'pipeline_queue_batches_last_total',
      help: 'Batches planned in the last wave',
      labelNames: ['tenant', 'queue'],
      registers: [reg],
    });
    this.queueBatchesLastDone = new Gauge({
      name: 'pipeline_queue_batches_last_done',
      help: 'Batches completed in the current wave',
      labelNames: ['tenant', 'queue'],
      registers: [reg],
    });

    this.consumerBatchDuration = new Histogram({
      name: 'pipeline_consumer_batch_duration_seconds',
      help: 'Time to process one consumer message',
      labelNames: ['tenant', 'queue'],
      buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
      registers: [reg],
    });
    this.consumerMessages = new Counter({
      name: 'pipeline_consumer_messages_total',
      help: 'Consumer messages by result',
      labelNames: ['tenant', 'queue', 'result'],
      registers: [reg],
    });

    this.producerPublished = new Counter({
      name: 'pipeline_producer_messages_published_total',
      help: 'Messages published by producer',
      labelNames: ['producer', 'tenant', 'target_queue'],
      registers: [reg],
    });
    this.producerLastPublish = new Gauge({
      name: 'pipeline_producer_last_publish_timestamp_seconds',
      help: 'Unix timestamp of last publish',
      labelNames: ['producer', 'tenant', 'target_queue'],
      registers: [reg],
    });
    this.producerLastBatchCount = new Gauge({
      name: 'pipeline_producer_last_batch_count',
      help: 'Messages in the last publish burst',
      labelNames: ['producer', 'tenant', 'target_queue'],
      registers: [reg],
    });
    this.producerActive = new Gauge({
      name: 'pipeline_producer_active',
      help: '1 if producer published in the last 120s',
      labelNames: ['producer', 'tenant'],
      registers: [reg],
    });

    this.scrapeEansTotal = new Counter({
      name: 'pipeline_scrape_eans_total',
      help: 'EANs sent to scraper',
      labelNames: ['tenant', 'origin'],
      registers: [reg],
    });
    this.scrapeFoundTotal = new Counter({
      name: 'pipeline_scrape_found_total',
      help: 'EANs found by scraper',
      labelNames: ['tenant', 'origin'],
      registers: [reg],
    });
    this.scrapeErrorsTotal = new Counter({
      name: 'pipeline_scrape_errors_total',
      help: 'EANs with scrape errors',
      labelNames: ['tenant', 'origin'],
      registers: [reg],
    });
    this.scrapeLastEans = new Gauge({
      name: 'pipeline_scrape_last_eans',
      help: 'EANs planned in the last scrape wave',
      labelNames: ['tenant', 'origin'],
      registers: [reg],
    });
    this.scrapeLastFound = new Gauge({
      name: 'pipeline_scrape_last_found',
      help: 'EANs found in the last scrape wave',
      labelNames: ['tenant', 'origin'],
      registers: [reg],
    });
    this.scrapeWaveDuration = new Gauge({
      name: 'pipeline_scrape_wave_duration_seconds',
      help: 'Duration of the last scrape wave by origin',
      labelNames: ['tenant', 'origin'],
      registers: [reg],
    });

    this.nextDailyRun = new Gauge({
      name: 'pipeline_next_daily_run_timestamp_seconds',
      help: 'Next daily pipeline cron (00:00 UTC)',
      registers: [reg],
    });
    this.dailyLastPublished = new Gauge({
      name: 'pipeline_daily_last_published_timestamp_seconds',
      help: 'Last pipeline.start publish from daily cron',
      registers: [reg],
    });
    this.outboxPending = new Gauge({
      name: 'pipeline_outbox_pending',
      help: 'Unpublished outbox rows',
      registers: [reg],
    });
    this.outboxMaxAttempts = new Gauge({
      name: 'pipeline_outbox_max_attempts',
      help: 'Max attempts among pending outbox rows',
      registers: [reg],
    });
    this.outboxOldestPendingAge = new Gauge({
      name: 'pipeline_outbox_oldest_pending_age_seconds',
      help: 'Age of oldest pending outbox row',
      registers: [reg],
    });
    this.outboxDrainBatch = new Gauge({
      name: 'pipeline_outbox_drain_batch_size',
      help: 'Messages drained in the last outbox tick',
      registers: [reg],
    });

    this.stepLastStarted = new Gauge({
      name: 'pipeline_step_last_started_timestamp_seconds',
      help: 'Last dispatch started_at',
      labelNames: ['tenant', 'step'],
      registers: [reg],
    });
    this.stepLastFinished = new Gauge({
      name: 'pipeline_step_last_finished_timestamp_seconds',
      help: 'Last dispatch finished_at',
      labelNames: ['tenant', 'step'],
      registers: [reg],
    });
    this.stepLastDuration = new Gauge({
      name: 'pipeline_step_last_duration_seconds',
      help: 'Last dispatch duration',
      labelNames: ['tenant', 'step'],
      registers: [reg],
    });
    this.stepLastStatus = new Gauge({
      name: 'pipeline_step_last_status',
      help: 'Last dispatch status',
      labelNames: ['tenant', 'step', 'status'],
      registers: [reg],
    });
    this.stepLastBatchesPlanned = new Gauge({
      name: 'pipeline_step_last_batches_planned',
      help: 'batches_planned on last dispatch',
      labelNames: ['tenant', 'step'],
      registers: [reg],
    });
    this.stepLastBatchesDone = new Gauge({
      name: 'pipeline_step_last_batches_done',
      help: 'batches_done on last dispatch',
      labelNames: ['tenant', 'step'],
      registers: [reg],
    });
    this.stepRunning = new Gauge({
      name: 'pipeline_step_running',
      help: '1 if last dispatch is running',
      labelNames: ['tenant', 'step'],
      registers: [reg],
    });
  }

  onModuleInit(): void {
    this.refreshNextDailyRun();
    this.resetStaleWavesOnBoot();
  }

  public onPublish(
    producer: string,
    tenant: string,
    targetQueue: string,
    count = 1,
  ): void {
    const labels = { producer, tenant, target_queue: targetQueue };
    this.producerPublished.inc(labels, count);
    const nowSec = Date.now() / 1000;
    this.producerLastPublish.set(labels, nowSec);
    this.producerLastBatchCount.set(labels, count);

    const key = `${producer}:${tenant}:${targetQueue}`;
    this.producers.set(key, {
      producer,
      tenant,
      targetQueue,
      lastPublishMs: Date.now(),
      lastBatchCount: count,
    });
    this.producerActive.set({ producer, tenant }, 1);
  }

  public onConsumeStart(tenant: string, queue: string): void {
    const key = `${tenant}:${queue}`;
    const now = Date.now();
    const existing = this.queueWaves.get(key);
    const gapSec = existing ? (now - existing.lastActivityMs) / 1000 : Infinity;
    const startNew =
      !existing || existing.status !== 'running' || gapSec > IDLE_GAP_SECONDS;

    if (startNew) {
      this.queueWaves.set(key, {
        tenant,
        queue,
        startedAtMs: now,
        batchesDone: 0,
        batchesTotalHint: existing?.batchesTotalHint ?? 0,
        inFlightLocal: 0,
        status: 'running',
        lastActivityMs: now,
      });
      this.queueLastStarted.set({ tenant, queue }, now / 1000);
      this.setQueueStatus(tenant, queue, 'running');
    }

    const wave = this.queueWaves.get(key)!;
    wave.inFlightLocal++;
    wave.lastActivityMs = now;
    wave.status = 'running';
    this.queueRunInProgress.set({ tenant, queue }, 1);
    this.setQueueStatus(tenant, queue, 'running');
  }

  public onConsumeEnd(
    tenant: string,
    queue: string,
    result: 'ok' | 'skip' | 'fail',
    durationSec: number,
  ): void {
    if (result !== 'skip') {
      this.consumerBatchDuration.observe({ tenant, queue }, durationSec);
    }
    this.consumerMessages.inc({ tenant, queue, result }, 1);

    const key = `${tenant}:${queue}`;
    const wave = this.queueWaves.get(key);
    if (!wave) return;

    wave.inFlightLocal = Math.max(0, wave.inFlightLocal - 1);
    wave.lastActivityMs = Date.now();
    if (result === 'ok') {
      wave.batchesDone++;
      this.queueBatchesLastDone.set({ tenant, queue }, wave.batchesDone);
    }
    if (result === 'fail') {
      wave.status = 'failed';
      this.finishWave(wave, 'failed');
      return;
    }

    if (queue.endsWith('.dispatch') && wave.inFlightLocal === 0) {
      this.finishWave(wave, 'completed');
      return;
    }

    this.tryFinishWaveFromRmq(wave);
  }

  public onDispatchBatches(
    tenant: string,
    step: string,
    countsPerQueue: Record<string, number>,
  ): void {
    for (const [queue, count] of Object.entries(countsPerQueue)) {
      const key = `${tenant}:${queue}`;
      const wave = this.queueWaves.get(key);
      if (wave) {
        wave.batchesTotalHint = count;
      } else {
        this.queueWaves.set(key, {
          tenant,
          queue,
          startedAtMs: Date.now(),
          batchesDone: 0,
          batchesTotalHint: count,
          inFlightLocal: 0,
          status: 'running',
          lastActivityMs: Date.now(),
        });
      }
      this.queueBatchesLastTotal.set({ tenant, queue }, count);
    }
  }

  public onScrapeDispatch(
    tenant: string,
    eansPerOrigin: Record<string, number>,
  ): void {
    for (const [origin, eans] of Object.entries(eansPerOrigin)) {
      const scrapeKey = `${tenant}:${origin}`;
      this.scrapeLastEans.set({ tenant, origin }, eans);
      this.scrapeLastFoundAcc.set(scrapeKey, 0);
      this.scrapeLastFound.set({ tenant, origin }, 0);
    }
  }

  public onScrapeBatch(
    tenant: string,
    origin: string,
    eans: number,
    found: number,
    errors: number,
  ): void {
    const labels = { tenant, origin };
    this.scrapeEansTotal.inc(labels, eans);
    this.scrapeFoundTotal.inc(labels, found);
    if (errors > 0) this.scrapeErrorsTotal.inc(labels, errors);
    const scrapeKey = `${tenant}:${origin}`;
    const total = (this.scrapeLastFoundAcc.get(scrapeKey) ?? 0) + found;
    this.scrapeLastFoundAcc.set(scrapeKey, total);
    this.scrapeLastFound.set(labels, total);
  }

  public recordDailyPipelinePublished(): void {
    this.dailyLastPublished.set(Date.now() / 1000);
  }

  public setOutboxDrainBatchSize(size: number): void {
    this.outboxDrainBatch.set(size);
  }

  public updateRmqQueues(queues: ReadonlyArray<RmqQueueSnapshot>): void {
    const nowSec = Math.floor(Date.now() / 1000);
    this.rmqByQueue.clear();
    for (const q of queues) {
      this.rmqByQueue.set(q.name, q);
      this.queueDepth.set({ queue: q.name }, q.messages);
      if (q.head_message_timestamp) {
        this.queueOldestAge.set(
          { queue: q.name },
          Math.max(0, nowSec - q.head_message_timestamp),
        );
      } else {
        this.queueOldestAge.set({ queue: q.name }, 0);
      }
      this.queueConsumers.set({ queue: q.name }, q.consumers ?? 0);
      this.queueUnacked.set({ queue: q.name }, q.messages_unacknowledged ?? 0);
      const stats = q.message_stats;
      this.queuePublishRate.set(
        { queue: q.name },
        stats?.publish_details?.rate ?? 0,
      );
      this.queueDeliverRate.set(
        { queue: q.name },
        stats?.deliver_get_details?.rate ?? 0,
      );
      this.queueAckRate.set({ queue: q.name }, stats?.ack_details?.rate ?? 0);
    }

    for (const wave of this.queueWaves.values()) {
      if (wave.status === 'running') {
        this.tryFinishWaveFromRmq(wave);
      }
    }
  }

  public updateOutboxMetrics(row: {
    pending: number;
    max_attempts: number;
    oldest_pending_age_seconds: number;
  }): void {
    this.outboxPending.set(row.pending);
    this.outboxMaxAttempts.set(row.max_attempts);
    this.outboxOldestPendingAge.set(row.oldest_pending_age_seconds);
  }

  public updatePipelineRuns(
    rows: ReadonlyArray<{
      tenant_id: string;
      step: string;
      status: string;
      batches_planned: number | null;
      batches_done: number | null;
      started_ts: number | null;
      finished_ts: number | null;
      duration_seconds: number | null;
    }>,
  ): void {
    for (const row of rows) {
      const labels = { tenant: row.tenant_id, step: row.step };
      if (row.started_ts != null) {
        this.stepLastStarted.set(labels, row.started_ts);
      }
      if (row.finished_ts != null) {
        this.stepLastFinished.set(labels, row.finished_ts);
      }
      if (row.duration_seconds != null) {
        this.stepLastDuration.set(labels, row.duration_seconds);
      }
      this.stepLastBatchesPlanned.set(labels, row.batches_planned ?? 0);
      this.stepLastBatchesDone.set(labels, row.batches_done ?? 0);
      this.stepRunning.set(labels, row.status === 'running' ? 1 : 0);
      this.setStepStatus(row.tenant_id, row.step, row.status);
    }
  }

  @Interval(30_000)
  public refreshDerivedGauges(): void {
    this.refreshNextDailyRun();
    const now = Date.now();
    const activeProducers = new Set<string>();

    for (const p of this.producers.values()) {
      const ageSec = (now - p.lastPublishMs) / 1000;
      const isActive = ageSec < PRODUCER_ACTIVE_SECONDS;
      if (isActive) activeProducers.add(`${p.producer}:${p.tenant}`);
      this.producerActive.set(
        { producer: p.producer, tenant: p.tenant },
        isActive ? 1 : 0,
      );
    }

    for (const wave of this.queueWaves.values()) {
      if (wave.status !== 'running') continue;
      const staleSec = (now - wave.lastActivityMs) / 1000;
      if (staleSec > STALE_RUN_SECONDS) {
        this.logger.warn(
          `Expiring stale queue wave ${wave.queue} tenant=${wave.tenant} (${staleSec}s idle)`,
        );
        wave.inFlightLocal = 0;
        this.finishWave(wave, 'failed');
      }
    }

    for (const wave of this.queueWaves.values()) {
      if (
        wave.status === 'completed' &&
        wave.queue.includes('import-competitor-products.')
      ) {
        const origin = wave.queue.split('.').pop()!;
        const duration = (wave.lastActivityMs - wave.startedAtMs) / 1000;
        this.scrapeWaveDuration.set({ tenant: wave.tenant, origin }, duration);
      }
    }
  }

  private refreshNextDailyRun(): void {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
      ),
    );
    this.nextDailyRun.set(next.getTime() / 1000);
  }

  private resetStaleWavesOnBoot(): void {
    this.queueRunInProgress.reset();
  }

  private tryFinishWaveFromRmq(wave: QueueWaveState): void {
    if (wave.status !== 'running' || wave.inFlightLocal > 0) return;
    const rmq = this.rmqByQueue.get(wave.queue);
    if (!rmq) return;
    if (rmq.messages > 0 || (rmq.messages_unacknowledged ?? 0) > 0) return;
    this.finishWave(wave, 'completed');
  }

  private finishWave(
    wave: QueueWaveState,
    status: 'completed' | 'failed',
  ): void {
    const now = Date.now();
    wave.status = status;
    wave.lastActivityMs = now;
    const labels = { tenant: wave.tenant, queue: wave.queue };
    const durationSec = (now - wave.startedAtMs) / 1000;
    this.queueLastFinished.set(labels, now / 1000);
    this.queueLastDuration.set(labels, durationSec);
    this.queueRunInProgress.set(labels, 0);
    this.setQueueStatus(wave.tenant, wave.queue, status);

    if (wave.queue.includes('import-competitor-products.')) {
      const origin = wave.queue.split('.').pop()!;
      this.scrapeWaveDuration.set({ tenant: wave.tenant, origin }, durationSec);
    }
  }

  private setQueueStatus(tenant: string, queue: string, status: string): void {
    for (const s of QUEUE_STATUSES) {
      this.queueLastStatus.set(
        { tenant, queue, status: s },
        s === status ? 1 : 0,
      );
    }
  }

  private setStepStatus(tenant: string, step: string, status: string): void {
    for (const s of STEP_STATUSES) {
      this.stepLastStatus.set(
        { tenant, step, status: s },
        s === status ? 1 : 0,
      );
    }
  }
}
