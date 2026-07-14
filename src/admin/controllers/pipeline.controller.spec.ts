import { BadRequestException } from '@nestjs/common';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { AdminPipelineService } from '../../pipeline/admin-pipeline.service';
import { PipelineController } from './pipeline.controller';

describe('PipelineController', () => {
  let service: {
    startForTenant: jest.Mock;
    triggerStep: jest.Mock;
  };
  let controller: PipelineController;

  beforeEach(() => {
    service = {
      startForTenant: jest.fn(),
      triggerStep: jest.fn().mockResolvedValue({
        pipelineRunId: 'run-id',
        step: PipelineStep.SYNC_BASE_PRODUCT,
      }),
    };
    controller = new PipelineController(
      service as unknown as AdminPipelineService,
    );
  });

  it('does not expose offer-book rule execution as a generic admin step', () => {
    expect(controller.steps().steps).not.toContain(
      PipelineStep.EXECUTE_OFFER_BOOK_RULE,
    );
  });

  it('rejects generic admin triggers for offer-book rule execution', () => {
    expect(() =>
      controller.triggerStep('acme', PipelineStep.EXECUTE_OFFER_BOOK_RULE),
    ).toThrow(BadRequestException);
    expect(service.triggerStep).not.toHaveBeenCalled();
  });

  it('continues forwarding an allowed pipeline step', async () => {
    await expect(
      controller.triggerStep('acme', PipelineStep.SYNC_BASE_PRODUCT),
    ).resolves.toEqual({
      pipelineRunId: 'run-id',
      step: PipelineStep.SYNC_BASE_PRODUCT,
    });
    expect(service.triggerStep).toHaveBeenCalledWith(
      'acme',
      PipelineStep.SYNC_BASE_PRODUCT,
    );
  });
});
