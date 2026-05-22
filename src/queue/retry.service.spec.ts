import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { RetryService } from './retry.service';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { MAX_ATTEMPTS } from './constants';

describe('RetryService', () => {
  let svc: RetryService;
  let amqp: { publish: jest.Mock };

  beforeEach(async () => {
    amqp = { publish: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [RetryService, { provide: AmqpConnection, useValue: amqp }],
    }).compile();
    svc = mod.get(RetryService);
  });

  it('publishes to retry queue for attempt < MAX', async () => {
    const result = await svc.republishOnFailure({
      pipelineRunId: 'r',
      tenantId: 'acme',
      step: PipelineStep.SYNC_BASE_PRODUCT,
      attempt: 1,
      publishedAt: 'now',
      payload: {},
    });
    expect(result).toBe('retried');
    const call = amqp.publish.mock.calls[0];
    expect(call[0]).toBe('');
    expect(call[1]).toMatch(/\.retry\.sync-base-product\.60000$/);
    expect(call[2].attempt).toBe(2);
  });

  it('publishes to DLQ when attempt >= MAX', async () => {
    const result = await svc.republishOnFailure({
      pipelineRunId: 'r',
      tenantId: 'acme',
      step: PipelineStep.SYNC_BASE_PRODUCT,
      attempt: MAX_ATTEMPTS,
      publishedAt: 'now',
      payload: {},
    });
    expect(result).toBe('dlq');
    expect(amqp.publish.mock.calls[0][0]).toMatch(/\.dlx$/);
  });
});
