import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { SchedulingTypeormEntity } from '../database/entities/scheduling.entity';
import { SchedulingRepository } from '../database/repositories/scheduling.repository';
import { CreateSchedulingBodyDto } from '../dto/create-scheduling-body.dto';

@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly schedulingRepository: SchedulingRepository) {}

  @Get()
  public getSchedulings(): Promise<SchedulingTypeormEntity[]> {
    return this.schedulingRepository.findAll();
  }

  @Get(':id')
  public getSchedulingById(@Param('id', ParseIntPipe) id: number): Promise<SchedulingTypeormEntity | null> {
    return this.schedulingRepository.findById(id);
  }

  @Post()
  public async createScheduling(@Body() body: CreateSchedulingBodyDto): Promise<SchedulingTypeormEntity> {
    const scheduling = new SchedulingTypeormEntity();
    scheduling.executionDate = new Date(body.executionDate);
    scheduling.baseProductId = body.baseProductId;
    scheduling.action = body.action;
    scheduling.value = body.value;
    scheduling.executed = false;

    return this.schedulingRepository.save(scheduling);
  }

  @Delete(':id')
  public async cancelScheduling(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.schedulingRepository.deleteById(id);
  }
}
