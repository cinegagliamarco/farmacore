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
    query: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      query: jest.fn(),
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
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ batchSeq: 0 }),
    );
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

  it('start: writes the provided batchSeq', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockResolvedValue({});
    await svc.start('run1', 'tid', PipelineStep.SYNC_BASE_PRODUCT, 1, 7);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ batchSeq: 7 }),
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ batchSeq: 7 }),
    );
  });

  it('recordDispatch: writes batches_planned on the dispatch row', async () => {
    repo.update.mockResolvedValue({});
    await svc.recordDispatch('run1', PipelineStep.SYNC_BASE_PRODUCT, 12);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ batchSeq: 0 }),
      { batchesPlanned: 12 },
    );
  });

  it('completeBatchAndIncrement: returns isLast=true when done reaches planned', async () => {
    const em = { query: jest.fn().mockResolvedValue([{ batches_done: 4, batches_planned: 4 }]) };
    const out = await svc.completeBatchAndIncrement(
      em as unknown as Parameters<typeof svc.completeBatchAndIncrement>[0],
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      3,
    );
    expect(out).toEqual({ done: 4, planned: 4, isLast: true });
    expect(em.query).toHaveBeenCalledWith(
      expect.stringMatching(/WITH batch_done AS/),
      expect.arrayContaining(['run1', PipelineStep.SYNC_BASE_PRODUCT, 3]),
    );
  });

  it('completeBatchAndIncrement: returns isLast=false when done < planned', async () => {
    const em = { query: jest.fn().mockResolvedValue([{ batches_done: 1, batches_planned: 4 }]) };
    const out = await svc.completeBatchAndIncrement(
      em as unknown as Parameters<typeof svc.completeBatchAndIncrement>[0],
      'run1',
      PipelineStep.SYNC_BASE_PRODUCT,
      1,
    );
    expect(out).toEqual({ done: 1, planned: 4, isLast: false });
  });

  it('completeBatchAndIncrement: throws when no dispatch row exists', async () => {
    const em = { query: jest.fn().mockResolvedValue([]) };
    await expect(
      svc.completeBatchAndIncrement(
        em as unknown as Parameters<typeof svc.completeBatchAndIncrement>[0],
        'run1',
        PipelineStep.SYNC_BASE_PRODUCT,
        1,
      ),
    ).rejects.toThrow(/no dispatch row/);
  });

  it('startOrRestartDispatch: returns already-completed when row is completed', async () => {
    repo.findOne.mockResolvedValue({ status: 'completed' });
    const out = await svc.startOrRestartDispatch(
      'run1',
      'tid',
      PipelineStep.SYNC_BASE_PRODUCT,
      1,
    );
    expect(out).toBe('already-completed');
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('startOrRestartDispatch: inserts a row when none exists', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockResolvedValue({});
    const out = await svc.startOrRestartDispatch(
      'run1',
      'tid',
      PipelineStep.SYNC_BASE_PRODUCT,
      1,
    );
    expect(out).toBe('started');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ batchSeq: 0, status: 'running' }),
    );
  });

  it('startOrRestartDispatch: resets a running row to retry (keeps batches_done)', async () => {
    repo.findOne.mockResolvedValue({ status: 'running' });
    repo.update.mockResolvedValue({});
    const out = await svc.startOrRestartDispatch(
      'run1',
      'tid',
      PipelineStep.SYNC_BASE_PRODUCT,
      2,
    );
    expect(out).toBe('started');
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ batchSeq: 0 }),
      expect.objectContaining({
        status: 'running',
        attempt: 2,
        batchesPlanned: null,
      }),
    );
    // batches_done is NOT in the update payload (preserved across restart)
    const updatePayload = repo.update.mock.calls[0][1];
    expect(updatePayload).not.toHaveProperty('batchesDone');
  });
});
