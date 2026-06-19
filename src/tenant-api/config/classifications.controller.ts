import { Controller, Get } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { ClassificationsService } from './classifications.service';

@Controller('classifications')
export class ClassificationsController {
  constructor(private readonly classifications: ClassificationsService) {}

  @Get()
  public list(@TenantEm() em: EntityManager): Promise<unknown[]> {
    return this.classifications.list(em);
  }

  @Get('grouped')
  public grouped(@TenantEm() em: EntityManager): Promise<unknown[]> {
    return this.classifications.grouped(em);
  }
}
