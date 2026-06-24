import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CredentialEncryptionService } from '../src/integration/credential-encryption.service';

/**
 * End-to-end coverage for the ERP health-check endpoints (PR #39). The
 * IntegrationConnectionService is unit-tested elsewhere; this boots the real
 * AppModule against a real DB to exercise what only an e2e can: the two
 * controllers, the role + SystemAdminGuard guards, the routing, and the
 * sanitized tenant-facing response.
 *
 * The real service runs (not overridden): we seed an *active*
 * core.integration_database_connection whose host/port point at an unreachable
 * target (127.0.0.1:1 → connection refused), so the live ping deterministically
 * resolves to ok:false without leaking the driver error to the tenant surface.
 *
 * Requires the same already-migrated local DB + broker as the other e2e specs
 * (NODE_ENV=development, core migrated). The tenant schema is created, migrated
 * and dropped per run, so it is self-contained.
 */
const SLUG = 'e2einteg';
const SCHEMA = 'tenant_e2einteg';
const SYS_EMAIL = 'sysadmin-integ@local.test';
const SYS_PASSWORD = 's3cret-sysadmin-please-rotate';

describe('Integration health (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let operatorToken: string;
  let systemToken: string;

  const login = async (
    email: string,
    password: string,
    tenantSlug: string,
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password, tenantSlug })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  };

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    await ds.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await ds.query(
      `INSERT INTO core.tenant (slug, name, schema_name, status)
       VALUES ($1, $1, $2, 'active') ON CONFLICT (slug) DO NOTHING`,
      [SLUG, SCHEMA],
    );
    const hash = await argon2.hash('secret123');
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ($1, 'admin@e2e.test', $2, 'admin', 'active'),
              ($1, 'op@e2e.test', $2, 'operator', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [SLUG, hash],
    );
    const sysHash = await argon2.hash(SYS_PASSWORD);
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ('system', $1, $2, 'admin', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [SYS_EMAIL, sysHash],
    );

    // Run the real, production tenant-migration script so the tenant DDL is
    // identical to prod (this spec touches only core, but mirrors the proven
    // setup so the schema is real and dropped cleanly).
    execSync(`npm run migration:tenant ${SLUG}`, { stdio: 'inherit' });

    // Active ERP connection pointing at an unreachable host. The real ping
    // refuses immediately, yielding ok:false. tenant_id here is the tenant's
    // uuid (FK to core.tenant.id) — distinct from core."user".tenant_id, which
    // stores the slug. password_encrypted is built with the real encryption
    // service so the row is byte-for-byte what production would store.
    const tenantRows: Array<{ id: string }> = await ds.query(
      `SELECT id FROM core.tenant WHERE slug = $1`,
      [SLUG],
    );
    const tenantId = tenantRows[0].id;
    const crypto = app.get(CredentialEncryptionService);
    const passwordEncrypted = crypto.encrypt('whatever');
    await ds.query(
      `INSERT INTO core.integration_database_connection
         (tenant_id, origin, name, type, host, port, database, username,
          password_encrypted, ssl_mode, read_only, connection_options, status)
       VALUES ($1, 'a7pharma', 'erp', 'postgres', '127.0.0.1', 1, 'erp',
               'erp', $2, 'disable', true, '{}'::jsonb, 'active')
       ON CONFLICT (tenant_id) DO UPDATE SET
         host = EXCLUDED.host, port = EXCLUDED.port, status = EXCLUDED.status,
         password_encrypted = EXCLUDED.password_encrypted`,
      [tenantId, passwordEncrypted],
    );

    adminToken = await login('admin@e2e.test', 'secret123', SLUG);
    operatorToken = await login('op@e2e.test', 'secret123', SLUG);
    systemToken = await login(SYS_EMAIL, SYS_PASSWORD, 'system');
  }, 60000);

  afterAll(async () => {
    // Resolve the tenant id here (not from a beforeAll var) so cleanup still
    // runs fully even if beforeAll aborted partway — no leaked schema/rows.
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      const rows: Array<{ id: string }> = await ds.query(
        `SELECT id FROM core.tenant WHERE slug = $1`,
        [SLUG],
      );
      const id = rows[0]?.id;
      if (id) {
        await ds.query(
          `DELETE FROM core.integration_database_connection WHERE tenant_id = $1`,
          [id],
        );
      }
      await ds.query(`DELETE FROM core."user" WHERE tenant_id = $1`, [SLUG]);
      await ds.query(
        `DELETE FROM core."user" WHERE tenant_id = 'system' AND email = $1`,
        [SYS_EMAIL],
      );
      await ds.query(`DELETE FROM core.tenant WHERE slug = $1`, [SLUG]);
    }
    await app?.close();
  });

  describe('GET /integration/health (tenant-facing)', () => {
    it('401s without a token', async () => {
      await request(app.getHttpServer()).get('/integration/health').expect(401);
    });

    it('403s for a tenant operator (admin-only)', async () => {
      await request(app.getHttpServer())
        .get('/integration/health')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('returns a sanitized ok:false for the tenant admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/integration/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = res.body as {
        ok: boolean;
        lastVerifiedAt: string | null;
      };
      expect(body.ok).toBe(false);
      expect(body).toHaveProperty('lastVerifiedAt');
      // The raw driver error / connection host must never reach the tenant.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('ECONNREFUSED');
      expect(serialized).not.toContain('127.0.0.1');
      expect(serialized).not.toMatch(/error/i);
    });
  });

  describe('GET /admin/integrations/health (fleet)', () => {
    it('403s for a non-system tenant admin (SystemAdminGuard)', async () => {
      await request(app.getHttpServer())
        .get('/admin/integrations/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('returns the fleet report for the system admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/integrations/health')
        .set('Authorization', `Bearer ${systemToken}`)
        .expect(200);
      const body = res.body as {
        total: number;
        healthy: number;
        unhealthy: number;
        connections: Array<{ tenantSlug: string; ok: boolean }>;
      };
      expect(body.total).toBe(body.healthy + body.unhealthy);
      expect(body.connections.length).toBe(body.total);
      const seeded = body.connections.find((c) => c.tenantSlug === SLUG);
      expect(seeded).toBeDefined();
      expect(seeded?.ok).toBe(false);
    });
  });
});
