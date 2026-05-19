import { Injectable, NotFoundException } from '@nestjs/common';
import { StatusSettingsRepository } from '../database/repositories/status-settings.repository';
import { UpdateStatusSettingsBodyDto } from '../dto/status-settings-body.dto';
import { StatusSettingsTypeormEntity } from '../database/entities/status-settings.entity';

@Injectable()
export class UpdateStatusSettingsUseCase {
  constructor(private readonly statusSettingsRepository: StatusSettingsRepository) {}

  public async execute(dto: UpdateStatusSettingsBodyDto): Promise<StatusSettingsTypeormEntity> {
    const existingSettings = await this.statusSettingsRepository.findFirst();
    if (!existingSettings) {
      throw new NotFoundException('Status settings not found');
    }

    if (dto.suspectBelow !== undefined) existingSettings.suspectBelow = dto.suspectBelow;
    if (dto.attentionBelow !== undefined) existingSettings.attentionBelow = dto.attentionBelow;
    if (dto.attentionAbove !== undefined) existingSettings.attentionAbove = dto.attentionAbove;
    if (dto.suspectAbove !== undefined) existingSettings.suspectAbove = dto.suspectAbove;

    return this.statusSettingsRepository.save(existingSettings);
  }
}

