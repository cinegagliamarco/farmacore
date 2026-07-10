import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PipelineJoinService } from './pipeline-join.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';

describe('PipelineJoinService.markBranchComplete', () => {
  let svc: PipelineJoinService;
  let repo: { createQueryBuilder: jest.Mock; count: jest.Mock };
  let orIgnore: jest.Mock;

  beforeEach(async () => {
    const qb = {
      insert: jest.fn(),
      values: jest.fn(),
      orIgnore: jest.fn(),
      execute: jest.fn().mockResolvedValue({}),
    };
    qb.insert.mockReturnValue(qb);
    qb.values.mockReturnValue(qb);
    qb.orIgnore.mockReturnValue(qb);
    orIgnore = qb.orIgnore;
    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      count: jest.fn(),
    };
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
    // DLQ replay re-inserts the same branch row — must be ON CONFLICT DO
    // NOTHING, not a plain save.
    expect(orIgnore).toHaveBeenCalled();
  });

  it('returns "fire" when both branches are complete', async () => {
    repo.count.mockResolvedValue(2);
    const r = await svc.markBranchComplete('run1', 'tid', 'stock-b');
    expect(r).toBe('fire');
  });
});
