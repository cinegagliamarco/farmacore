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
import { UserRole } from '../../database/enums/user-role.enum';
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
      // Runtime-aware: prod runs from dist/ (ts-node is pruned), dev runs
      // from src/ via ts-node. CreateTenantDto's slug regex restricts to
      // [a-z0-9-], so this shell interpolation is safe.
      const cmd = __dirname.includes('/dist/')
        ? `node dist/scripts/migrate-tenant.js ${dto.slug}`
        : `npm run migration:tenant ${dto.slug}`;
      execSync(cmd, { stdio: 'inherit' });
    } catch (err) {
      this.logger.error(
        `Tenant onboarding failed for ${dto.slug}: ${(err as Error).message}`,
      );
      // Rollback so retries work without manual DROP SCHEMA / DELETE.
      // Best-effort: log cleanup failures but always re-throw the original.
      try {
        await this.dataSource.query(
          `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
        );
      } catch (e) {
        this.logger.warn(
          `Cleanup DROP SCHEMA "${schemaName}" failed: ${(e as Error).message}`,
        );
      }
      try {
        await this.tenants.delete({ id: tenant.id });
      } catch (e) {
        this.logger.warn(
          `Cleanup DELETE tenant "${dto.slug}" failed: ${(e as Error).message}`,
        );
      }
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
      role: UserRole.ADMIN,
      status: 'active',
    });

    return {
      slug: dto.slug,
      schemaName,
      initialAdminUser: { email: dto.adminEmail, oneTimePassword },
    };
  }
}
