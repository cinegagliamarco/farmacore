import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto';
import { INTEGRATION_ENTITIES } from './entities';

@Injectable()
export class IntegrationConnectionService {
  private readonly logger = new Logger(IntegrationConnectionService.name);

  constructor(
    @InjectRepository(IntegrationDatabaseConnectionEntity)
    private readonly repo: Repository<IntegrationDatabaseConnectionEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
    private readonly crypto: CredentialEncryptionService,
    private readonly factory: IntegrationDataSourceFactory,
  ) {}

  public async upsert(
    tenantSlug: string,
    dto: UpsertIntegrationDto,
  ): Promise<IntegrationDatabaseConnectionEntity> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);

    const existing = await this.repo.findOne({ where: { tenantId: tenant.id } });
    const payload: Partial<IntegrationDatabaseConnectionEntity> = {
      tenantId: tenant.id,
      name: dto.name,
      type: 'postgres',
      host: dto.host,
      port: dto.port,
      database: dto.database,
      username: dto.username,
      passwordEncrypted: this.crypto.encrypt(dto.password),
      sslMode: dto.sslMode ?? 'require',
      sslCaCert: dto.sslCaCert ?? null,
      readOnly: dto.readOnly ?? true,
      connectionOptions: dto.connectionOptions ?? {},
      status: 'active',
    };

    const saved = existing
      ? await this.repo.save({ ...existing, ...payload })
      : await this.repo.save(payload);

    await this.factory.invalidate(tenant.id);
    this.logger.log(`Upserted integration connection for tenant ${tenantSlug}`);
    return saved;
  }

  public async disable(tenantSlug: string): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);
    const row = await this.repo.findOne({ where: { tenantId: tenant.id } });
    if (!row) return;
    row.status = 'disabled';
    await this.repo.save(row);
    await this.factory.invalidate(tenant.id);
  }

  public async test(
    tenantSlug: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);
    const row = await this.repo.findOne({ where: { tenantId: tenant.id } });
    if (!row) throw new NotFoundException('No integration connection configured');

    const password = await this.crypto.decrypt(row.passwordEncrypted);
    const ds = new DataSource({
      type: 'postgres',
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password,
      ssl:
        row.sslMode === 'disable'
          ? false
          : {
              rejectUnauthorized: row.sslMode === 'verify-full',
              ca: row.sslCaCert ?? undefined,
            },
      entities: INTEGRATION_ENTITIES,
      synchronize: false,
    });
    try {
      await ds.initialize();
      await ds.query('SELECT 1');
      row.lastVerifiedAt = new Date();
      row.lastError = null;
      await this.repo.save(row);
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message;
      row.lastError = message;
      await this.repo.save(row);
      return { ok: false, error: message };
    } finally {
      if (ds.isInitialized) await ds.destroy().catch(() => undefined);
    }
  }
}
