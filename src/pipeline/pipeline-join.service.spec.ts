import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PipelineJoinService } from './pipeline-join.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';

describe('PipelineJoinService.markBranchComplete', () => {
  let svc: PipelineJoinService;
  let repo: { save: jest.Mock; count: jest.Mock };

  beforeEach(async () => {
    repo = { save: jest.fn(), count: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        PipelineJoinService,
        { provide: getRepositoryToken(PipelineRunEntity), useValue: repo },
      ],
    }).compile();
    svc = mod.get(PipelineJoinService);
  });

  it('returns "wait" when only one branch row exists', async () => {
    repo.count.mockResolvedValue(1);
    const r = await svc.markBranchComplete('run1', 'tid', 'stock-a');
    expect(r).toBe('wait');
  });

  it('returns "fire" when both branches are complete', async () => {
    repo.count.mockResolvedValue(2);
    const r = await svc.markBranchComplete('run1', 'tid', 'stock-b');
    expect(r).toBe('fire');
  });
});
