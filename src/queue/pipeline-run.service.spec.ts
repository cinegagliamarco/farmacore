import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PipelineRunService } from './pipeline-run.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

describe('PipelineRunService', () => {
  let svc: PipelineRunService;
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        PipelineRunService,
        { provide: getRepositoryToken(PipelineRunEntity), useValue: repo },
      ],
    }).compile();
    svc = mod.get(PipelineRunService);
  });

  it('start: inserts a running row when none exists', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockImplementation((x: PipelineRunEntity) =>
      Promise.resolve({ ...x, id: 'id1' }),
    );
    const result = await svc.start(
      'run1',
      'tid',
      PipelineStep.SYNC_BASE_PRODUCT,
      1,
    );
    expect(result).toBe('started');
    expect(repo.save).toHaveBeenCalled();
  });

  it('start: returns "already-completed" when a completed row exists', async () => {
    repo.findOne.mockResolvedValue({ status: 'completed' });
    const result = await svc.start(
      'run1',
      'tid',
      PipelineStep.SYNC_BASE_PRODUCT,
      1,
    );
    expect(result).toBe('already-completed');
  });

  it('start: returns "in-progress" when a running row exists', async () => {
    repo.findOne.mockResolvedValue({ status: 'running' });
    const result = await svc.start(
      'run1',
      'tid',
      PipelineStep.SYNC_BASE_PRODUCT,
      1,
    );
    expect(result).toBe('in-progress');
  });
});
