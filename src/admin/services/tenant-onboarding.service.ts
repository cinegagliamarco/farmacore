import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import { TenantEntity } from '../../database/entities/core/tenant.entity';
import { UserEntity } from '../../database/entities/core/user.entity';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantStatus } from '../../database/enums/tenant-status.enum';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { PasswordService } from '../../auth/password.service';
import { RESERVED_SLUGS, schemaNameFor } from '../../tenant/tenant-schema';
import { runTenantMigration } from '../../tenant/run-tenant-migration';

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
    if (RESERVED_SLUGS.has(dto.slug))
      throw new BadRequestException(`slug "${dto.slug}" is reserved`);

    const existing = await this.tenants.findOne({ where: { slug: dto.slug } });
    if (existing)
      throw new ConflictException(`Tenant ${dto.slug} already exists`);

    const schemaName = schemaNameFor(dto.slug);

    // Nasce com todos os módulos; restringir é ação explícita do admin
    // via PUT /admin/tenants/:slug/modules.
    const tenant: TenantEntity = await this.tenants.save({
      slug: dto.slug,
      name: dto.name,
      schemaName,
      status: TenantStatus.ACTIVE,
      modules: Object.values(ModuleCode),
    });

    try {
      await this.dataSource.query(
        `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
      );
      await runTenantMigration(dto.slug);

      const origins = Object.values(CompetitorOrigin);
      await this.dataSource.query(
        `INSERT INTO core.tenant_competitor_origin (tenant_id, origin, enabled)
         VALUES ${origins.map((_, i) => `($1, $${i + 2}, false)`).join(', ')}
         ON CONFLICT (tenant_id, origin) DO NOTHING`,
        [tenant.id, ...origins],
      );

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
  }
}
