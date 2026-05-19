import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateStatusSettingsBodyDto } from '../dto/status-settings-body.dto';
import { GetStatusSettingsUseCase } from '../use-cases/get-status-settings.use-case';
import { UpdateStatusSettingsUseCase } from '../use-cases/update-status-settings.use-case';
import { StatusSettingsTypeormEntity } from '../database/entities/status-settings.entity';

@Controller('settings/variation-status')
export class StatusSettingsController {
  constructor(
    private readonly getStatusSettingsUseCase: GetStatusSettingsUseCase,
    private readonly updateStatusSettingsUseCase: UpdateStatusSettingsUseCase
  ) {}

  @Get()
  public get(): Promise<StatusSettingsTypeormEntity> {
    return this.getStatusSettingsUseCase.execute();
  }

  @Patch()
  public update(@Body() dto: UpdateStatusSettingsBodyDto): Promise<StatusSettingsTypeormEntity> {
    return this.updateStatusSettingsUseCase.execute(dto);
  }
}

