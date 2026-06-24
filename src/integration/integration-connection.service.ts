import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  IntegrationDatabaseConnectionEntity,
  IntegrationStatus,
} from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { IntegrationOrigin } from '../database/enums/integration-origin.enum';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto';
import { entitiesForOrigin } from './entities';

export interface IntegrationHealthEntry {
  tenantSlug: string;
  origin: IntegrationOrigin;
  status: IntegrationStatus;
  ok: boolean;
  lastVerifiedAt: Date | null;
  error: string | null;
}

export interface IntegrationHealthReport {
  checkedAt: Date;
  total: number;
  healthy: number;
  unhealthy: number;
  connections: IntegrationHealthEntry[];
}

// `lastVerifiedAt` rides in the result (not read from the caller's row) so all
// single-flight-coalesced callers report the same timestamp as the shared ping.
type PingResult =
  | { ok: true; lastVerifiedAt: Date }
  | { ok: false; lastVerifiedAt: Date | null; error: string };

@Injectable()
export class IntegrationConnectionService {
  private readonly logger = new Logger(IntegrationConnectionService.name);

  // Short-lived in-flight/result cache, keyed by connection id. Stores the
  // ping *promise* so concurrent callers coalesce onto one ERP connection
  // (single-flight) and sequential polls within the TTL reuse the result.
  // Evicted on disable()/upsert() so a config change is never served stale.
  private readonly pingCache = new Map<
    string,
    { result: Promise<PingResult>; at: number }
  >();
  private static readonly PING_TTL_MS = 10_000;
  // Bounds how many ERP connections the fleet check opens at once.
  private static readonly FLEET_PING_CONCURRENCY = 8;

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

    const existing = await this.repo.findOne({
      where: { tenantId: tenant.id },
    });
    const payload: Partial<IntegrationDatabaseConnectionEntity> = {
      tenantId: tenant.id,
      origin: dto.origin,
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
      apiBaseUrl: dto.apiBaseUrl ?? existing?.apiBaseUrl ?? null,
      apiKeyEncrypted: dto.apiKey
        ? this.crypto.encrypt(dto.apiKey)
        : (existing?.apiKeyEncrypted ?? null),
    };

    const saved = existing
      ? await this.repo.save({ ...existing, ...payload })
      : await this.repo.save(payload);

    await this.factory.invalidate(tenant.id);
    this.pingCache.delete(saved.id);
    this.logger.log(`Upserted integration connection for tenant ${tenantSlug}`);
    return saved;
  }

  /** Per-tenant A7Pharma REST API credentials for write-back, or null if
   *  not configured (reads still work via the DB connection). */
  public async getApiCredentials(
    tenantSlug: string,
  ): Promise<{ baseUrl: string; apiKey: string } | null> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) return null;
    const row = await this.repo.findOne({ where: { tenantId: tenant.id } });
    if (!row || !row.apiBaseUrl || !row.apiKeyEncrypted) return null;
    const apiKey = await this.crypto.decrypt(row.apiKeyEncrypted);
    return { baseUrl: row.apiBaseUrl, apiKey };
  }

  public async disable(tenantSlug: string): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);
    const row = await this.repo.findOne({ where: { tenantId: tenant.id } });
    if (!row) return;
    row.status = 'disabled';
    await this.repo.save(row);
    await this.factory.invalidate(tenant.id);
    this.pingCache.delete(row.id);
  }

  public async test(
    tenantSlug: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await this.ping(await this.rowForSlug(tenantSlug));
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  /**
   * Tenant-facing variant of {@link test}: reports only whether the tenant's
   * own ERP is reachable and when it last verified. The raw driver error is
   * withheld on purpose — connection host/credentials are Farmacore-managed
   * infra, not the tenant's to see. System admins get the full error via
   * {@link test} / the fleet report.
   */
  public async testForTenant(
    tenantSlug: string,
  ): Promise<{ ok: boolean; lastVerifiedAt: Date | null }> {
    const row = await this.rowForSlug(tenantSlug);
    // A disabled integration is intentionally off: report not-healthy without
    // contacting credentials the system decided to stop using.
    if (row.status !== 'active') {
      return { ok: false, lastVerifiedAt: row.lastVerifiedAt ?? null };
    }
    const result = await this.cachedPing(row);
    return { ok: result.ok, lastVerifiedAt: result.lastVerifiedAt };
  }

  /**
   * Pings every configured ERP connection in parallel and reports each
   * tenant's reachability. A single tenant's dead ERP surfaces as
   * `ok: false`, never as a 500 for the whole report — so monitoring can
   * read the full fleet in one call.
   */
  public async testAll(): Promise<IntegrationHealthReport> {
    // Only active connections — a disabled integration is intentionally off,
    // never used by IntegrationDataSourceFactory, and must not be contacted
    // with its stored credentials nor counted as a fleet health concern.
    const rows = await this.repo.find({
      where: { status: 'active' },
      relations: { tenant: true },
    });
    const connections = await this.mapWithLimit(
      rows,
      IntegrationConnectionService.FLEET_PING_CONCURRENCY,
      async (row): Promise<IntegrationHealthEntry> => {
        const result = await this.cachedPing(row);
        return {
          tenantSlug: row.tenant?.slug ?? row.tenantId,
          origin: row.origin,
          status: row.status,
          ok: result.ok,
          lastVerifiedAt: result.lastVerifiedAt,
          error: result.ok ? null : result.error,
        };
      },
    );
    const healthy = connections.filter((c) => c.ok).length;
    return {
      checkedAt: new Date(),
      total: connections.length,
      healthy,
      unhealthy: connections.length - healthy,
      connections,
    };
  }

  private async rowForSlug(
    tenantSlug: string,
  ): Promise<IntegrationDatabaseConnectionEntity> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);
    const row = await this.repo.findOne({ where: { tenantId: tenant.id } });
    if (!row)
      throw new NotFoundException('No integration connection configured');
    return row;
  }

  /** {@link ping} wrapped in a short-TTL single-flight cache (keyed by
   *  connection id) so polled/hammered health endpoints don't open an ERP
   *  connection per request, and a burst of concurrent callers shares one
   *  in-flight ping. The explicit single-tenant {@link test} stays uncached —
   *  a manual "test connection" must always attempt a fresh connection.
   *  Relies on {@link ping} never rejecting (so a failure isn't cached as a
   *  rejected promise). */
  private cachedPing(
    row: IntegrationDatabaseConnectionEntity,
  ): Promise<PingResult> {
    const cached = this.pingCache.get(row.id);
    if (
      cached &&
      Date.now() - cached.at < IntegrationConnectionService.PING_TTL_MS
    ) {
      return cached.result;
    }
    const result = this.ping(row);
    this.pingCache.set(row.id, { result, at: Date.now() });
    return result;
  }

  /**
   * Opens a throwaway connection, runs `SELECT 1`, and records the outcome
   * on the row (`lastVerifiedAt`/`lastError`). Never throws: credential
   * decrypt, connect, and query failures all resolve to `ok: false` so every
   * caller (single, tenant-facing, fleet) degrades to a status instead of a
   * 500. `status` is left untouched on purpose: a transient health blip must
   * not flip a connection to 'error' and pull it out of
   * `IntegrationDataSourceFactory`'s rotation. The pooled connection with
   * connect + statement timeouts keeps an unreachable or hung host from
   * stalling the check. The raw driver message is returned to the caller (the
   * system-admin surface that asked) but only a sanitized reason is persisted
   * to `last_error`, so the stored column never carries host/credential text.
   */
  private async ping(
    row: IntegrationDatabaseConnectionEntity,
  ): Promise<PingResult> {
    let ds: DataSource | undefined;
    try {
      const password = await this.crypto.decrypt(row.passwordEncrypted);
      ds = new DataSource({
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
        entities: [...entitiesForOrigin(row.origin)],
        synchronize: false,
        // connectionTimeoutMillis bounds connect; statement/query_timeout bound
        // a host that accepts the connection then hangs the SELECT 1.
        extra: {
          max: 1,
          connectionTimeoutMillis: 5000,
          statement_timeout: 5000,
          query_timeout: 5000,
        },
      });
      await ds.initialize();
      await ds.query('SELECT 1');
      row.lastVerifiedAt = new Date();
      row.lastError = null;
      await this.persist(row);
      return { ok: true, lastVerifiedAt: row.lastVerifiedAt };
    } catch (err) {
      row.lastError = this.safeReason(err);
      await this.persist(row);
      return {
        ok: false,
        lastVerifiedAt: row.lastVerifiedAt ?? null,
        error: (err as Error).message,
      };
    } finally {
      if (ds?.isInitialized) await ds.destroy().catch(() => undefined);
    }
  }

  /** A diagnostic, infra-free summary for the persisted `last_error`: the
   *  driver's error code (SQLSTATE / errno like `ECONNREFUSED`) when present,
   *  never the raw message — which can carry host, port, or username. */
  private safeReason(err: unknown): string {
    const code = (err as { code?: string | number }).code;
    return code !== undefined
      ? `connection error (${code})`
      : 'connection error';
  }

  /** Runs `fn` over `items` with at most `limit` in flight, preserving order.
   *  Bounds outbound ERP connections + core writes during the fleet check.
   *  `fn` must not reject (one rejection would abort the whole batch); the
   *  only caller passes {@link cachedPing}, which never rejects. */
  private async mapWithLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => worker()),
    );
    return results;
  }

  /** Best-effort write of *only* the health columns. Never `save(row)` the
   *  whole hydrated entity: the row is read at the start of a ping that can
   *  take seconds, and a concurrent `disable()` / credential rotation would
   *  be clobbered by the stale snapshot. A failure here (e.g. core DB blip)
   *  must not turn a health check into a 500. */
  private async persist(
    row: IntegrationDatabaseConnectionEntity,
  ): Promise<void> {
    try {
      await this.repo.update(row.id, {
        lastVerifiedAt: row.lastVerifiedAt,
        lastError: row.lastError,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist health result for tenant ${row.tenantId}: ${(err as Error).message}`,
      );
    }
  }
}
