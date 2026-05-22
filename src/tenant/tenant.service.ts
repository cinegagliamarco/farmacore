import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { TenantStatus } from '../database/enums/tenant-status.enum';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly repo: Repository<TenantEntity>,
  ) {}

  public async findBySlug(slug: string): Promise<TenantEntity> {
    const t = await this.repo.findOne({ where: { slug } });
    if (!t) throw new NotFoundException(`Tenant ${slug} not found`);
    return t;
  }

  public async findActive(slug: string): Promise<TenantEntity> {
    const t = await this.findBySlug(slug);
    if (t.status !== TenantStatus.ACTIVE) {
      throw new NotFoundException(`Tenant ${slug} is not active`);
    }
    return t;
  }

  public listActive(): Promise<TenantEntity[]> {
    return this.repo.find({ where: { status: TenantStatus.ACTIVE } });
  }
}
