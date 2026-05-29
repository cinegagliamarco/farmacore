import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { RetryService } from '../src/queue/retry.service';
import { newPipelineMessage } from '../src/queue/types';
import { PipelineStep } from '../src/database/enums/pipeline-step.enum';

/**
 * Exercises the dead-letter routing without a full pipeline run. There
 * are no retries: a failed message is dead-lettered to the DLX on the
 * first failure and the broker must receive it on the `{step}.dlq`
 * mirror.
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

  it('dead-letters a failed message to {step}.dlq on first failure', async () => {
    const runId = randomUUID();
    const msg = newPipelineMessage({
      pipelineRunId: runId,
      tenantId: 'system',
      step: PipelineStep.SYNC_OFFER_BOOKS_INFO,
      payload: { probe: true },
    });

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
});
