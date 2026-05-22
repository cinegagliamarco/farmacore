import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { INTEGRATION_ENTITIES } from './entities';

@Injectable()
export class IntegrationDataSourceFactory implements OnModuleDestroy {
  private readonly logger = new Logger(IntegrationDataSourceFactory.name);
  private readonly cache = new Map<string, DataSource>();

  constructor(
    @InjectRepository(IntegrationDatabaseConnectionEntity)
    private readonly repo: Repository<IntegrationDatabaseConnectionEntity>,
    private readonly crypto: CredentialEncryptionService,
  ) {}

  public async forTenant(tenantId: string): Promise<DataSource | null> {
    const cached = this.cache.get(tenantId);
    if (cached?.isInitialized) return cached;

    const row = await this.repo.findOne({
      where: { tenantId, status: 'active' },
    });
    if (!row) return null;

    const password = await this.crypto.decrypt(row.passwordEncrypted);
    const poolSize = Number(
      (row.connectionOptions as { poolSize?: number })?.poolSize ?? 5,
    );

    const dataSource = new DataSource({
      type: row.type,
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
      logging: false,
      extra: { ...(row.connectionOptions ?? {}), max: poolSize },
    });

    await dataSource.initialize();
    if (row.readOnly) {
      await dataSource.query(`SET default_transaction_read_only = on`);
    }

    this.cache.set(tenantId, dataSource);
    this.logger.log(
      `Initialized integration DataSource for tenant ${tenantId}`,
    );
    return dataSource;
  }

  public async forTenantSlug(tenantSlug: string): Promise<DataSource | null> {
    const tenant = await this.repo.manager.findOne(TenantEntity, {
      where: { slug: tenantSlug },
    });
    if (!tenant) return null;
    return this.forTenant(tenant.id);
  }

  public async invalidate(tenantId: string): Promise<void> {
    const ds = this.cache.get(tenantId);
    if (ds?.isInitialized) await ds.destroy();
    this.cache.delete(tenantId);
  }

  public async onModuleDestroy(): Promise<void> {
    for (const [, ds] of this.cache) {
      if (ds.isInitialized) await ds.destroy().catch(() => undefined);
    }
    this.cache.clear();
  }
}
