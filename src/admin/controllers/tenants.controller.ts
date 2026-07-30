import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import {
  TenantOnboardingService,
  OnboardingResult,
} from '../services/tenant-onboarding.service';
import { TenantOffboardingService } from '../services/tenant-offboarding.service';
import { TenantService } from '../../tenant/tenant.service';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantStatusDto } from '../dto/update-tenant-status.dto';
import { UpdateTenantModulesDto } from '../dto/update-tenant-modules.dto';
import { UpdateTenantStoreLimitDto } from '../dto/update-tenant-store-limit.dto';
import { TenantEntity } from '../../database/entities/core/tenant.entity';

@Controller('admin/tenants')
@UseGuards(SystemAdminGuard)
export class TenantsController {
  constructor(
    private readonly onboarding: TenantOnboardingService,
    private readonly offboarding: TenantOffboardingService,
    private readonly tenants: TenantService,
    @InjectRepository(TenantEntity)
    private readonly repo: Repository<TenantEntity>,
  ) {}

  @Post()
  public create(@Body() dto: CreateTenantDto): Promise<OnboardingResult> {
    return this.onboarding.create(dto);
  }

  @Get()
  public list(): Promise<TenantEntity[]> {
    return this.repo.find({ order: { slug: 'ASC' } });
  }

  @Get(':slug')
  public show(@Param('slug') slug: string): Promise<TenantEntity> {
    return this.tenants.findBySlug(slug);
  }

  @Patch(':slug/status')
  public async updateStatus(
    @Param('slug') slug: string,
    @Body() dto: UpdateTenantStatusDto,
  ): Promise<void> {
    const t = await this.tenants.findBySlug(slug);
    t.status = dto.status;
    await this.repo.save(t);
  }

  @Put(':slug/modules')
  public async updateModules(
    @Param('slug') slug: string,
    @Body() dto: UpdateTenantModulesDto,
  ): Promise<void> {
    const t = await this.tenants.findBySlug(slug);
    t.modules = dto.modules;
    await this.repo.save(t);
  }

  // Baixar o limite abaixo do nº de lojas já ativas não desativa nenhuma;
  // apenas bloqueia novas ativações até o tenant ficar dentro da cota.
  @Put(':slug/store-limit')
  public async updateStoreLimit(
    @Param('slug') slug: string,
    @Body() dto: UpdateTenantStoreLimitDto,
  ): Promise<void> {
    const t = await this.tenants.findBySlug(slug);
    t.storeLimit = dto.storeLimit;
    await this.repo.save(t);
  }

  @Delete(':slug')
  public softDelete(@Param('slug') slug: string): Promise<void> {
    return this.offboarding.softDelete(slug);
  }
}
