import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from '../../database/entities/core/tenant.entity';
import { TenantStatus } from '../../database/enums/tenant-status.enum';

@Injectable()
export class TenantOffboardingService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
  ) {}

  public async softDelete(slug: string): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { slug } });
    if (!tenant) throw new NotFoundException();
    tenant.status = TenantStatus.SUSPENDED;
    tenant.deletedAt = new Date();
    await this.tenants.save(tenant);
  }
}
