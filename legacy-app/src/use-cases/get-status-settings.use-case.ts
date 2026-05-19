import { Injectable, NotFoundException } from '@nestjs/common';
import { StatusSettingsRepository } from '../database/repositories/status-settings.repository';
import { StatusSettingsTypeormEntity } from '../database/entities/status-settings.entity';

@Injectable()
export class GetStatusSettingsUseCase {
  constructor(private readonly statusSettingsRepository: StatusSettingsRepository) {}

  public async execute(): Promise<StatusSettingsTypeormEntity> {
    const settings = await this.statusSettingsRepository.findFirst();
    if (!settings) {
      throw new NotFoundException('Status settings not found');
    }
    return settings;
  }
}

