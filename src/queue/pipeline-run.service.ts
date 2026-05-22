import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineRunStatus } from '../database/enums/pipeline-run-status.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export type StartOutcome = 'started' | 'already-completed' | 'in-progress';

@Injectable()
export class PipelineRunService {
  constructor(
    @InjectRepository(PipelineRunEntity)
    private readonly repo: Repository<PipelineRunEntity>,
  ) {}

  public async start(
    pipelineRunId: string,
    tenantId: string,
    step: PipelineStep,
    attempt: number,
  ): Promise<StartOutcome> {
    const existing = await this.repo.findOne({
      where: { pipelineRunId, step },
    });
    if (existing?.status === PipelineRunStatus.COMPLETED)
      return 'already-completed';
    if (existing?.status === PipelineRunStatus.RUNNING) return 'in-progress';
    await this.repo.save({
      pipelineRunId,
      tenantId,
      step,
      attempt,
      status: PipelineRunStatus.RUNNING,
      startedAt: new Date(),
    });
    return 'started';
  }

  public async complete(
    pipelineRunId: string,
    step: PipelineStep,
  ): Promise<void> {
    await this.repo.update(
      { pipelineRunId, step },
      { status: PipelineRunStatus.COMPLETED, finishedAt: new Date() },
    );
  }

  public async fail(
    pipelineRunId: string,
    step: PipelineStep,
    error: string,
  ): Promise<void> {
    await this.repo.update(
      { pipelineRunId, step },
      {
        status: PipelineRunStatus.FAILED,
        finishedAt: new Date(),
        error: error.slice(0, 4000),
      },
    );
  }

  public async isCompleted(
    pipelineRunId: string,
    step: PipelineStep,
  ): Promise<boolean> {
    const row = await this.repo.findOne({
      where: { pipelineRunId, step, status: PipelineRunStatus.COMPLETED },
    });
    return row !== null;
  }
}
