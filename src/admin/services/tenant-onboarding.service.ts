import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { TenantEntity } from '../../database/entities/core/tenant.entity';
import { UserEntity } from '../../database/entities/core/user.entity';
import { TenantStatus } from '../../database/enums/tenant-status.enum';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { PasswordService } from '../../auth/password.service';

const RESERVED = new Set([
  'admin',
  'api',
  'app',
  'meta',
  'shared',
  'system',
  'www',
]);

export interface OnboardingResult {
  slug: string;
  schemaName: string;
  initialAdminUser: { email: string; oneTimePassword: string };
}

@Injectable()
export class TenantOnboardingService {
  private readonly logger = new Logger(TenantOnboardingService.name);

  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
  ) {}

  public async create(dto: CreateTenantDto): Promise<OnboardingResult> {
    if (RESERVED.has(dto.slug))
      throw new BadRequestException(`slug "${dto.slug}" is reserved`);

    const existing = await this.tenants.findOne({ where: { slug: dto.slug } });
    if (existing)
      throw new ConflictException(`Tenant ${dto.slug} already exists`);

    const schemaName = `tenant_${dto.slug.replace(/-/g, '_')}`;

    const tenant: TenantEntity = await this.tenants.save({
      slug: dto.slug,
      name: dto.name,
      schemaName,
      status: TenantStatus.ACTIVE,
    });

    try {
      await this.dataSource.query(
        `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
      );
      execSync(`npm run migration:tenant ${dto.slug}`, { stdio: 'inherit' });
    } catch (err) {
      this.logger.error(
        `Tenant onboarding failed for ${dto.slug}: ${(err as Error).message}`,
      );
      tenant.status = TenantStatus.SUSPENDED;
      await this.tenants.save(tenant);
      throw err;
    }

    await this.dataSource.transaction(async (em) => {
      await em.query(
        `SET LOCAL search_path TO "${schemaName}", shared_catalog, public`,
      );
      for (const origin of Object.values(CompetitorOrigin)) {
        await em.query(
          `INSERT INTO tenant_competitor_origin (origin, enabled) VALUES ($1, false)
           ON CONFLICT (origin) DO NOTHING`,
          [origin],
        );
      }
    });

    const oneTimePassword = crypto.randomBytes(18).toString('base64url');
    const hash = await this.passwords.hash(oneTimePassword);
    await this.users.save({
      tenantId: dto.slug,
      email: dto.adminEmail,
      passwordHash: hash,
      role: 'admin',
      status: 'active',
    });

    return {
      slug: dto.slug,
      schemaName,
      initialAdminUser: { email: dto.adminEmail, oneTimePassword },
    };
  }
}
