import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { StatusSettingsTypeormEntity } from '../entities/status-settings.entity';

@Injectable()
export class StatusSettingsRepository {
  constructor(private readonly repository: Repository<StatusSettingsTypeormEntity>) {}

  public async findFirst(): Promise<StatusSettingsTypeormEntity | null> {
    return this.repository.findOne({
      where: {},
      order: { id: 'ASC' }
    });
  }

  public async findById(id: number): Promise<StatusSettingsTypeormEntity | null> {
    return this.repository.findOne({
      where: { id }
    });
  }

  public async save(entity: StatusSettingsTypeormEntity): Promise<StatusSettingsTypeormEntity> {
    return this.repository.save(entity);
  }
}

