import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { RetryService } from './retry.service';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

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

  it('dead-letters a failed message straight to the DLX (no retries)', async () => {
    const result = await svc.republishOnFailure({
      pipelineRunId: 'r',
      tenantId: 'acme',
      step: PipelineStep.SYNC_BASE_PRODUCT,
      attempt: 1,
      publishedAt: 'now',
      payload: {},
    });
    expect(result).toBe('dlq');
    const call = amqp.publish.mock.calls[0];
    expect(call[0]).toMatch(/\.dlx$/);
    expect(call[1]).toBe('acme.sync-base-product');
  });
});
