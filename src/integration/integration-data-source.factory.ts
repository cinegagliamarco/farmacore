import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { entitiesForOrigin } from './entities';

@Injectable()
export class IntegrationDataSourceFactory implements OnModuleDestroy {
  private readonly logger = new Logger(IntegrationDataSourceFactory.name);
  // Caches the in-flight promise (not the DataSource) so concurrent calls
  // for the same tenant share one connection attempt instead of leaking
  // an orphaned pool.
  private readonly cache = new Map<string, Promise<DataSource | null>>();

  constructor(
    @InjectRepository(IntegrationDatabaseConnectionEntity)
    private readonly repo: Repository<IntegrationDatabaseConnectionEntity>,
    private readonly crypto: CredentialEncryptionService,
  ) {}

  public async forTenant(tenantId: string): Promise<DataSource | null> {
    const cached = this.cache.get(tenantId);
    if (cached) return cached;

    const pending = this.connect(tenantId);
    this.cache.set(tenantId, pending);
    try {
      const ds = await pending;
      if (!ds) this.cache.delete(tenantId);
      return ds;
    } catch (err) {
      this.cache.delete(tenantId);
      throw err;
    }
  }

  private async connect(tenantId: string): Promise<DataSource | null> {
    const row = await this.repo.findOne({
      where: { tenantId, status: 'active' },
    });
    if (!row) return null;

    const password = this.crypto.decrypt(row.passwordEncrypted);
    const poolSize = Number(
      (row.connectionOptions as { poolSize?: number })?.poolSize ?? 5,
    );
    const extra: Record<string, unknown> = {
      ...(row.connectionOptions ?? {}),
      max: poolSize,
      // Bounds pool connects so a hung ERP host can't stall graceful shutdown.
      connectionTimeoutMillis: 10_000,
    };
    if (row.readOnly) {
      // Startup parameter so EVERY pooled connection is read-only; a one-off
      // `SET` query would only reach the single session that ran it.
      extra.options = '-c default_transaction_read_only=on';
    }

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
      entities: [...entitiesForOrigin(row.origin)],
      synchronize: false,
      logging: false,
      extra,
    });

    await dataSource.initialize();
    this.logger.log(
      `Initialized integration DataSource for tenant ${tenantId} (origin=${row.origin})`,
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
    const pending = this.cache.get(tenantId);
    this.cache.delete(tenantId);
    const ds = await pending?.catch(() => null);
    if (ds?.isInitialized) await ds.destroy();
  }

  public async onModuleDestroy(): Promise<void> {
    for (const [, pending] of this.cache) {
      const ds = await pending.catch(() => null);
      if (ds?.isInitialized) await ds.destroy().catch(() => undefined);
    }
    this.cache.clear();
  }
}
