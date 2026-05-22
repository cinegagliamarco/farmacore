import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

describe('PipelinePublisher', () => {
  let svc: PipelinePublisher;
  let amqp: { publish: jest.Mock };

  beforeEach(async () => {
    amqp = { publish: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [
        PipelinePublisher,
        { provide: AmqpConnection, useValue: amqp },
      ],
    }).compile();
    svc = mod.get(PipelinePublisher);
  });

  it('publishes a start message with routing key <slug>.pipeline.start', async () => {
    await svc.publishStart('acme', { reason: 'manual', startedBy: 'u1' });
    expect(amqp.publish).toHaveBeenCalledWith(
      expect.any(String),
      'acme.pipeline.start',
      expect.objectContaining({ tenantId: 'acme', step: 'pipeline.start' }),
      expect.anything(),
    );
  });

  it('publishes a step message with routing key <slug>.<step>', async () => {
    await svc.publishStep({
      pipelineRunId: 'run1',
      tenantId: 'acme',
      step: PipelineStep.SYNC_BASE_PRODUCT,
      attempt: 1,
      publishedAt: new Date().toISOString(),
      payload: {},
    });
    expect(amqp.publish).toHaveBeenCalledWith(
      expect.any(String),
      'acme.sync-base-product',
      expect.objectContaining({ step: 'sync-base-product' }),
      expect.anything(),
    );
  });
});
