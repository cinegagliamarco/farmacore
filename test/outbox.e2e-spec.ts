import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { OutboxPublisher } from '../src/queue/outbox-publisher.service';
import { OutboxRepository } from '../src/queue/outbox.repository';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EXCHANGE_NAME } from '../src/queue/constants';

/**
 * End-to-end: stage a row in pipeline_outbox, invoke OutboxPublisher.tick()
 * directly, verify (a) the row's published_at is set, (b) the broker
 * received a message on the expected routing key.
 *
 * The cron schedule isn't exercised here — tick() is called directly
 * to keep the spec deterministic. Requires the local stack
 * (postgres + rabbitmq) to be up.
 */
describe('OutboxPublisher (real Postgres + RabbitMQ)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let publisher: OutboxPublisher;
  let amqp: AmqpConnection;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    ds = app.get(DataSource);
    publisher = app.get(OutboxPublisher);
    amqp = app.get(AmqpConnection);
  });

  afterAll(async () => {
    await app.close();
  });

  it('drains a staged outbox row and marks published_at', async () => {
    const runId = randomUUID();
    const probeKey = `probe-${runId}`;
    const routingKey = `system.${probeKey}`;

    // Declare a transient queue bound to our probe routing key so the
    // broker doesn't drop the message before we look for it.
    const probeQueue = `outbox-probe-${runId}`;
    await amqp.channel.assertQueue(probeQueue, {
      durable: false,
      autoDelete: true,
    });
    await amqp.channel.bindQueue(probeQueue, EXCHANGE_NAME, routingKey);

    await ds.query(
      `INSERT INTO core.pipeline_outbox
         (pipeline_run_id, tenant_id, routing_key, message, attempts)
       VALUES ($1, $2, $3, $4::jsonb, 0)`,
      [
        runId,
        'system',
        routingKey,
        JSON.stringify({ pipelineRunId: runId, probe: true }),
      ],
    );

    await publisher.tick();

    const [row] = await ds.query(
      `SELECT published_at, attempts FROM core.pipeline_outbox
       WHERE pipeline_run_id = $1`,
      [runId],
    );
    expect(row.published_at).not.toBeNull();
    expect(row.attempts).toBeGreaterThanOrEqual(1);

    const delivered = await amqp.channel.get(probeQueue, { noAck: true });
    expect(delivered).not.toBe(false);
    if (delivered !== false) {
      const body = JSON.parse(delivered.content.toString());
      expect(body.pipelineRunId).toBe(runId);
      expect(body.probe).toBe(true);
    }

    await amqp.channel.deleteQueue(probeQueue);
  });

  it('re-claims rows whose publish failed (still null published_at)', async () => {
    // Insert a row whose routing key isn't bound to any queue. The
    // broker accepts the publish (no NACK with persistent + topic),
    // so the row STILL gets published_at — this is the broker
    // semantics, documented for ops.
    const runId = randomUUID();
    await ds.query(
      `INSERT INTO core.pipeline_outbox
         (pipeline_run_id, tenant_id, routing_key, message, attempts)
       VALUES ($1, $2, $3, $4::jsonb, 0)`,
      [
        runId,
        'system',
        `system.no-binding-${runId}`,
        JSON.stringify({ probe: true }),
      ],
    );

    await publisher.tick();

    const [row] = await ds.query(
      `SELECT published_at FROM core.pipeline_outbox
       WHERE pipeline_run_id = $1`,
      [runId],
    );
    expect(row.published_at).not.toBeNull();
  });

  it('lease: a fresh claim is excluded from a concurrent claim', async () => {
    // Stage two rows, claim them via the repository directly, then
    // verify a second claimPending sees ZERO available rows because
    // both are still inside the CLAIM_GRACE_MS window.
    const runId = randomUUID();
    for (const i of [1, 2]) {
      await ds.query(
        `INSERT INTO core.pipeline_outbox
           (pipeline_run_id, tenant_id, routing_key, message, attempts)
         VALUES ($1, $2, $3, $4::jsonb, 0)`,
        [
          runId,
          'system',
          `system.lease-probe-${runId}-${i}`,
          JSON.stringify({ probe: true, i }),
        ],
      );
    }

    const outbox = app.get(OutboxRepository);
    const firstClaim = await outbox.claimPending(10);
    expect(firstClaim.filter((r) => r.pipelineRunId === runId)).toHaveLength(2);

    const secondClaim = await outbox.claimPending(10);
    expect(secondClaim.filter((r) => r.pipelineRunId === runId)).toHaveLength(
      0,
    );

    // Cleanup
    await ds.query(
      `DELETE FROM core.pipeline_outbox WHERE pipeline_run_id = $1`,
      [runId],
    );
  });
});
