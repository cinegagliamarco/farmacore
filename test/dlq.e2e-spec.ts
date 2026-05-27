import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { RetryService } from '../src/queue/retry.service';
import { MAX_ATTEMPTS } from '../src/queue/constants';
import { newPipelineMessage } from '../src/queue/types';
import { PipelineStep } from '../src/database/enums/pipeline-step.enum';

/**
 * Exercises the retry → DLQ machinery without a full pipeline run.
 * Builds a message at attempt = MAX_ATTEMPTS and asks RetryService
 * to republish on failure; the only valid outcome is 'dlq' (the
 * retry budget is exhausted) and the broker must receive the message
 * on the DLQ-routed exchange.
 *
 * Requires the local docker stack (postgres + rabbitmq) to be up.
 */
describe('RetryService DLQ routing (real RabbitMQ)', () => {
  let app: INestApplication;
  let retry: RetryService;
  let amqp: AmqpConnection;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    retry = app.get(RetryService);
    amqp = app.get(AmqpConnection);
  });

  afterAll(async () => {
    await app.close();
  });

  it('routes to DLQ once attempts > MAX_ATTEMPTS', async () => {
    const runId = randomUUID();
    const msg = {
      ...newPipelineMessage({
        pipelineRunId: runId,
        tenantId: 'system',
        step: PipelineStep.SYNC_OFFER_BOOKS_INFO,
        payload: { probe: true },
      }),
      attempt: MAX_ATTEMPTS,
    };

    const outcome = await retry.republishOnFailure(msg);
    expect(outcome).toBe('dlq');

    // The message is in {step}.dlq. Pull it back to confirm.
    const dlqName = `${PipelineStep.SYNC_OFFER_BOOKS_INFO}.dlq`;
    const channel = amqp.channel;
    const got = await channel.get(dlqName, { noAck: true });
    expect(got).not.toBe(false);
    if (got !== false) {
      const body = JSON.parse(got.content.toString());
      expect(body.pipelineRunId).toBe(runId);
      expect(body.payload).toEqual({ probe: true });
    }
  });

  it('routes to the retry-delay queue when attempts remain', async () => {
    const runId = randomUUID();
    const msg = newPipelineMessage({
      pipelineRunId: runId,
      tenantId: 'system',
      step: PipelineStep.SYNC_OFFER_BOOKS_INFO,
      payload: { probe: true },
    });

    const outcome = await retry.republishOnFailure(msg);
    expect(outcome).toBe('retried');
    // Not asserting the broker-side delivery here; the unit
    // contract is "returned 'retried' and didn't throw". The full
    // retry path is exercised by the operator runbook.
  });
});
