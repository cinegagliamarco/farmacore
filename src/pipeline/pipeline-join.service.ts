import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineRunStatus } from '../database/enums/pipeline-run-status.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export type JoinBranch = 'stock-a' | 'stock-b';

@Injectable()
export class PipelineJoinService {
  constructor(
    @InjectRepository(PipelineRunEntity)
    private readonly repo: Repository<PipelineRunEntity>,
  ) {}

  public async markBranchComplete(
    pipelineRunId: string,
    tenantId: string,
    branch: JoinBranch,
  ): Promise<'wait' | 'fire'> {
    const stepKey = `branch.${branch}` as PipelineStep;
    // Commits outside the tenant tx, so a DLQ replay re-runs this insert.
    // ON CONFLICT DO NOTHING (UQ_PIPELINE_RUN_RUN_STEP_BATCH) keeps the
    // replay idempotent instead of poisoning it with a unique violation.
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({
        pipelineRunId,
        tenantId,
        step: stepKey,
        status: PipelineRunStatus.COMPLETED,
        attempt: 1,
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      .orIgnore()
      .execute();
    const count = await this.repo.count({
      where: [
        {
          pipelineRunId,
          step: 'branch.stock-a' as PipelineStep,
          status: PipelineRunStatus.COMPLETED,
        },
        {
          pipelineRunId,
          step: 'branch.stock-b' as PipelineStep,
          status: PipelineRunStatus.COMPLETED,
        },
      ],
    });
    return count >= 2 ? 'fire' : 'wait';
  }
}
