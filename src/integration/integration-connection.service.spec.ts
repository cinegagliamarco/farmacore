import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IntegrationConnectionService } from './integration-connection.service';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';

// `SELECT 1` rejects when host === 'unreachable', so a row can be made to
// fail its health ping by its host alone.
jest.mock('typeorm', () => {
  const actual = jest.requireActual<typeof import('typeorm')>('typeorm');
  return {
    ...actual,
    DataSource: jest.fn().mockImplementation((opts: { host: string }) => ({
      isInitialized: false,
      initialize: jest.fn().mockImplementation(function (this: {
        isInitialized: boolean;
      }) {
        this.isInitialized = true;
        return Promise.resolve(this);
      }),
      query: jest.fn().mockImplementation(() =>
        opts.host === 'unreachable'
          ? Promise.reject(
              // Real pg errors carry host/port in the message and an errno code.
              Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
                code: 'ECONNREFUSED',
              }),
            )
          : Promise.resolve(undefined),
      ),
      destroy: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

type Row = Partial<IntegrationDatabaseConnectionEntity> & { slug?: string };

const row = (
  over: Row & { slug: string },
): IntegrationDatabaseConnectionEntity =>
  ({
    id: `id-${over.slug}`,
    tenantId: `t-${over.slug}`,
    origin: 'a7pharma',
    host: 'db',
    port: 5432,
    database: 'erp',
    username: 'u',
    passwordEncrypted: Buffer.from('x'),
    sslMode: 'require',
    sslCaCert: null,
    readOnly: true,
    status: 'active',
    lastVerifiedAt: null,
    lastError: null,
    tenant: { slug: over.slug },
    ...over,
  }) as unknown as IntegrationDatabaseConnectionEntity;

describe('IntegrationConnectionService', () => {
  let service: IntegrationConnectionService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
  };
  let tenants: { findOne: jest.Mock };
  let crypto: { decrypt: jest.Mock; encrypt: jest.Mock };
  let factory: { invalidate: jest.Mock };

  beforeEach(async () => {
    (DataSource as unknown as jest.Mock).mockClear();
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockImplementation((r: unknown) => Promise.resolve(r)),
    };
    tenants = { findOne: jest.fn() };
    crypto = {
      decrypt: jest.fn().mockReturnValue('secret'),
      encrypt: jest.fn().mockReturnValue(Buffer.from('enc')),
    };
    factory = { invalidate: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        IntegrationConnectionService,
        {
          provide: getRepositoryToken(IntegrationDatabaseConnectionEntity),
          useValue: repo,
        },
        { provide: getRepositoryToken(TenantEntity), useValue: tenants },
        { provide: CredentialEncryptionService, useValue: crypto },
        { provide: IntegrationDataSourceFactory, useValue: factory },
      ],
    }).compile();
    service = mod.get(IntegrationConnectionService);
  });

  it('reports each tenant and aggregates healthy/unhealthy counts', async () => {
    repo.find.mockResolvedValue([
      row({ slug: 'acme', host: 'db' }),
      row({ slug: 'beta', host: 'unreachable' }),
    ]);

    const report = await service.testAll();

    expect(report.total).toBe(2);
    expect(report.healthy).toBe(1);
    expect(report.unhealthy).toBe(1);

    const acme = report.connections.find((c) => c.tenantSlug === 'acme')!;
    expect(acme.ok).toBe(true);
    expect(acme.error).toBeNull();
    expect(acme.lastVerifiedAt).toBeInstanceOf(Date);

    const beta = report.connections.find((c) => c.tenantSlug === 'beta')!;
    expect(beta.ok).toBe(false);
    expect(beta.error).toContain('ECONNREFUSED');
  });

  it('persists only the health columns, never the whole row', async () => {
    const failing = row({ slug: 'beta', host: 'unreachable' });
    repo.find.mockResolvedValue([failing]);

    await service.testAll();

    // Targeted update by id — a save(row) would clobber a concurrent
    // disable()/credential rotation with this stale snapshot.
    expect(repo.update).toHaveBeenCalledWith(failing.id, {
      lastVerifiedAt: failing.lastVerifiedAt,
      lastError: failing.lastError,
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('stores a sanitized reason in last_error but reports the raw error to admins', async () => {
    const failing = row({ slug: 'beta', host: 'unreachable' });
    repo.find.mockResolvedValue([failing]);

    const report = await service.testAll();

    // Admin (system) surface keeps the full driver message for debugging.
    expect(report.connections[0].error).toContain('10.0.0.5');
    // Persisted column carries only the errno, never host/port/credentials.
    const persisted = repo.update.mock.calls[0][1].lastError as string;
    expect(persisted).toBe('connection error (ECONNREFUSED)');
    expect(persisted).not.toContain('10.0.0.5');
  });

  it('only pings active connections', async () => {
    repo.find.mockResolvedValue([]);

    await service.testAll();

    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'active' } }),
    );
  });

  it('pings every active connection through the bounded mapper', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({ slug: `t${i}`, host: 'db' }),
    );
    repo.find.mockResolvedValue(many);

    const report = await service.testAll();

    expect(report.total).toBe(20);
    expect(report.healthy).toBe(20);
    expect(DataSource as unknown as jest.Mock).toHaveBeenCalledTimes(20);
  });

  it('falls back to tenantId when the tenant relation is absent', async () => {
    const orphan = row({ slug: 'x', host: 'db' });
    delete (orphan as { tenant?: unknown }).tenant;
    repo.find.mockResolvedValue([orphan]);

    const report = await service.testAll();

    expect(report.connections[0].tenantSlug).toBe(orphan.tenantId);
  });

  it('reports a tenant whose credentials fail to decrypt as unhealthy', async () => {
    const bad = row({ slug: 'corrupt', host: 'db' });
    const good = row({ slug: 'acme', host: 'db' });
    repo.find.mockResolvedValue([bad, good]);
    // Credential decrypt throws for the corrupt row; ping resolves ok:false
    // instead of throwing, so the fleet report still covers everyone.
    crypto.decrypt.mockImplementation((cipher: Buffer) => {
      if (cipher === bad.passwordEncrypted) throw new Error('bad key');
      return 'secret';
    });

    const report = await service.testAll();

    expect(report.total).toBe(2);
    expect(report.healthy).toBe(1);
    const corrupt = report.connections.find((c) => c.tenantSlug === 'corrupt')!;
    expect(corrupt.ok).toBe(false);
    expect(corrupt.error).toContain('bad key');
    expect(report.connections.find((c) => c.tenantSlug === 'acme')!.ok).toBe(
      true,
    );
  });

  it('returns an empty report when no connections are configured', async () => {
    repo.find.mockResolvedValue([]);

    const report = await service.testAll();

    expect(report).toMatchObject({ total: 0, healthy: 0, unhealthy: 0 });
    expect(report.connections).toEqual([]);
  });

  describe('testForTenant', () => {
    it('returns ok + lastVerifiedAt and never the raw driver error', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(row({ slug: 'acme', host: 'db' }));

      const out = await service.testForTenant('acme');

      expect(out.ok).toBe(true);
      expect(out.lastVerifiedAt).toBeInstanceOf(Date);
      expect(out).not.toHaveProperty('error');
    });

    it('reports ok:false without leaking the connection error', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'beta' });
      repo.findOne.mockResolvedValue(
        row({ slug: 'beta', host: 'unreachable' }),
      );

      const out = await service.testForTenant('beta');

      expect(out.ok).toBe(false);
      expect(out).not.toHaveProperty('error');
      expect(JSON.stringify(out)).not.toContain('ECONNREFUSED');
    });

    it('404s when the tenant has no integration configured', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(null);

      await expect(service.testForTenant('acme')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the tenant does not exist', async () => {
      tenants.findOne.mockResolvedValue(null);

      await expect(service.testForTenant('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('degrades to ok:false (no throw, no leak) when decrypt fails', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(row({ slug: 'acme', host: 'db' }));
      crypto.decrypt.mockImplementation(() => {
        throw new Error('bad key: host=10.0.0.5');
      });

      const out = await service.testForTenant('acme');

      expect(out.ok).toBe(false);
      expect(JSON.stringify(out)).not.toContain('bad key');
      expect(JSON.stringify(out)).not.toContain('10.0.0.5');
    });

    it('stays ok:true when persisting the result fails', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(row({ slug: 'acme', host: 'db' }));
      repo.update.mockRejectedValue(new Error('core DB blip'));

      const out = await service.testForTenant('acme');

      expect(out.ok).toBe(true);
    });

    it('throttles repeated checks: only one ERP connection within the TTL', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(row({ slug: 'acme', host: 'db' }));

      const first = await service.testForTenant('acme');
      const second = await service.testForTenant('acme');

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      // Second call is served from the short-TTL cache — no fresh ERP connect.
      expect(DataSource as unknown as jest.Mock).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent checks onto a single ERP connection', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(row({ slug: 'acme', host: 'db' }));

      const [a, b] = await Promise.all([
        service.testForTenant('acme'),
        service.testForTenant('acme'),
      ]);

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      // Single-flight: both share one in-flight ping, not two.
      expect(DataSource as unknown as jest.Mock).toHaveBeenCalledTimes(1);
      // Both coalesced callers report the shared ping's timestamp, not a
      // stale one read from their own row instance.
      expect(a.lastVerifiedAt).toBeInstanceOf(Date);
      expect(b.lastVerifiedAt).toEqual(a.lastVerifiedAt);
    });

    it('reports ok:false for a disabled connection without pinging it', async () => {
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(
        row({ slug: 'acme', host: 'db', status: 'disabled' }),
      );

      const out = await service.testForTenant('acme');

      expect(out.ok).toBe(false);
      // Disabled credentials are never contacted.
      expect(DataSource as unknown as jest.Mock).not.toHaveBeenCalled();
    });

    it('evicts the cache on rotation so the next check re-pings', async () => {
      const r = row({ slug: 'acme', host: 'db', status: 'active' });
      tenants.findOne.mockResolvedValue({ id: 't1', slug: 'acme' });
      repo.findOne.mockResolvedValue(r);

      await service.testForTenant('acme'); // populates cache
      await service.upsert('acme', {
        origin: 'a7pharma',
        name: 'erp',
        host: 'newhost',
        port: 5432,
        database: 'd',
        username: 'u',
        password: 'p',
      } as never);
      await service.testForTenant('acme'); // cache evicted → fresh ping

      expect(DataSource as unknown as jest.Mock).toHaveBeenCalledTimes(2);
    });
  });
});
