import { Injectable } from '@nestjs/common';
import { LessThanOrEqual, Repository } from 'typeorm';
import { SchedulingTypeormEntity } from '../entities/scheduling.entity';

@Injectable()
export class SchedulingRepository {
  constructor(private readonly repository: Repository<SchedulingTypeormEntity>) {}

  public findAll(): Promise<SchedulingTypeormEntity[]> {
    return this.repository.find({
      relations: ['baseProduct'],
      order: { executionDate: 'ASC' }
    });
  }

  public findById(id: number): Promise<SchedulingTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['baseProduct']
    });
  }

  public findPendingSchedulings(currentDate: Date): Promise<SchedulingTypeormEntity[]> {
    return this.repository.find({
      where: {
        executed: false,
        executionDate: LessThanOrEqual(currentDate)
      },
      relations: ['baseProduct'],
      order: { executionDate: 'ASC' }
    });
  }

  public save(entity: SchedulingTypeormEntity): Promise<SchedulingTypeormEntity> {
    return this.repository.save(entity);
  }

  public async deleteById(id: number): Promise<void> {
    await this.repository.delete({ id });
  }
}

