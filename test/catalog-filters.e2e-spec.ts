import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { A7PharmaApiClient } from '../src/integration/a7-pharma-api.client';
import { IntegrationConnectionService } from '../src/integration/integration-connection.service';

/**
 * End-to-end coverage for the catalog FILTER endpoints over the REAL SQL.
 * The unit spec mocks em.query; this boots the real AppModule against a real
 * DB so the filter WHERE clauses (active, receipt_date window), the perPage
 * clamp, the competitor LEFT JOINs (null with no shared_catalog rows) and the
 * strategic-price / generic-missing predicates actually run as SQL. Only the
 * external ERP (A7Pharma) is mocked.
 *
 * Requires the same already-migrated local DB + broker as the other e2e specs
 * (NODE_ENV=development, core + shared_catalog migrated). The tenant schema is
 * created, migrated and dropped per run, so it is self-contained.
 */
const SLUG = 'e2ecatfilter';
const SCHEMA = 'tenant_e2ecatfilter';
// Private EAN triplet (789666… is unused by any other test/ file): this spec
// DELETEs these from the cross-tenant shared_catalog.product in beforeAll, and
// jest runs e2e files in parallel — colliding with an EAN another spec seeds
// there (e.g. pricing-suggestions' 7893333333333) would race and wipe its row.
const EAN_ACTIVE = '7896666666661';
const EAN_INACTIVE = '7896666666662';
const EAN_GENERIC_MISSING = '7896666666663';
const ALL_EANS = `${EAN_ACTIVE}, ${EAN_INACTIVE}, ${EAN_GENERIC_MISSING}`;

const a7 = { changePrices: jest.fn(), upsertOffer: jest.fn() };
const credentials = { baseUrl: 'https://erp.test', apiKey: 'key' };

interface ProductRow {
  ean: string;
  active: boolean;
}

describe('Catalog filters (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(A7PharmaApiClient)
      .useValue(a7)
      .overrideProvider(IntegrationConnectionService)
      .useValue({ getApiCredentials: jest.fn().mockResolvedValue(credentials) })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    // Tenant + admin user in core.
    await ds.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await ds.query(
      `INSERT INTO core.tenant (slug, name, schema_name, status)
       VALUES ($1, $1, $2, 'active') ON CONFLICT (slug) DO NOTHING`,
      [SLUG, SCHEMA],
    );
    const hash = await argon2.hash('secret123');
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ($1, 'admin@e2e.test', $2, 'admin', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [SLUG, hash],
    );

    // Tenant schema: run the real, production tenant-migration script
    // (resolves schema_name from the core.tenant row inserted above), then
    // seed. Delegating to the script keeps the DDL identical to prod.
    execSync(`npm run migration:tenant ${SLUG}`, { stdio: 'inherit' });

    // P_ACTIVE: active, generic, has active_ingredient, in OK status, has a
    //   non-empty deals jsonb (so it surfaces in strategic-price).
    // P_INACTIVE: active=false, later receipt_date.
    // P_GENERIC_MISSING: active+generic but active_ingredient NULL.
    await ds.query(
      `INSERT INTO ${SCHEMA}.product
         (ean, name, active, price, cost, generic, active_ingredient,
          receipt_date, status, deals) VALUES
        (${EAN_ACTIVE}, 'Dipirona 500mg', true, 10.00, 5.0000, true, 'DIPIRONA',
          '2026-01-10', 'OK', '{"caderno": "promo"}'::jsonb),
        (${EAN_INACTIVE}, 'Descontinuado', false, 8.00, 5.0000, false, NULL,
          '2026-03-15', 'OK', NULL),
        (${EAN_GENERIC_MISSING}, 'Genérico sem princípio', true, 12.00, 6.0000,
          true, NULL, '2026-02-01', 'OK', NULL)`,
    );
    // Own stock for P_ACTIVE so GET /products/stock returns own-stock numbers.
    await ds.query(
      `INSERT INTO ${SCHEMA}.product_stock (ean, subsidiary_external_id, quantity)
       VALUES (${EAN_ACTIVE}, 1, 7)`,
    );
    // shared_catalog is cross-tenant; clear any leftover competitor rows for
    // these synthetic EANs so the competitor LEFT JOINs stay deterministically
    // null regardless of prior DB state.
    await ds.query(
      `DELETE FROM shared_catalog.product WHERE ean IN (${ALL_EANS})`,
    );

    const tenantRows: Array<{ id: string }> = await ds.query(
      `SELECT id FROM core.tenant WHERE slug = $1`,
      [SLUG],
    );
    const tenantId = tenantRows[0].id;
    await ds.query(
      `INSERT INTO core.tenant_competitor_origin (tenant_id, origin, enabled, priority)
       VALUES ($1, 'DROGAL', true, 10),
              ($1, 'DROGASIL', true, 20)
       ON CONFLICT (tenant_id, origin) DO UPDATE
         SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority`,
      [tenantId],
    );

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@e2e.test', password: 'secret123', tenantSlug: SLUG })
      .expect(200);
    token = (login.body as { accessToken: string }).accessToken;
  }, 60000);

  afterAll(async () => {
    // Use the module constants (not values captured during the test) so
    // cleanup still runs fully even if beforeAll aborted partway — no leaked
    // schema/rows.
    if (ds?.isInitialized) {
      const tenantRows: Array<{ id: string }> = await ds.query(
        `SELECT id FROM core.tenant WHERE slug = $1`,
        [SLUG],
      );
      const tenantId = tenantRows[0]?.id;
      if (tenantId) {
        await ds.query(
          `DELETE FROM core.tenant_competitor_origin WHERE tenant_id = $1`,
          [tenantId],
        );
      }
      await ds.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await ds.query(`DELETE FROM core."user" WHERE tenant_id = $1`, [SLUG]);
      await ds.query(`DELETE FROM core.tenant WHERE slug = $1`, [SLUG]);
    }
    await app?.close();
  });

  describe('auth boundary', () => {
    it('401s on /products without a token', async () => {
      await request(app.getHttpServer()).get('/products').expect(401);
    });
  });

  describe('GET /products?active', () => {
    it('active=true excludes the inactive product', async () => {
      const res = await get('/products?active=true').expect(200);
      const eans = (res.body.rows as ProductRow[]).map((r) => r.ean).sort();
      expect(eans).toEqual([EAN_ACTIVE, EAN_GENERIC_MISSING].sort());
    });

    it('active=false returns only the inactive product', async () => {
      const res = await get('/products?active=false').expect(200);
      expect(res.body.count).toBe(1);
      expect((res.body.rows as ProductRow[])[0].ean).toBe(EAN_INACTIVE);
    });
  });

  describe('GET /products receipt_date window', () => {
    it('receiptFrom=2026-02-01 excludes the January product', async () => {
      const res = await get('/products?receiptFrom=2026-02-01').expect(200);
      const eans = (res.body.rows as ProductRow[]).map((r) => r.ean).sort();
      expect(eans).toEqual([EAN_INACTIVE, EAN_GENERIC_MISSING].sort());
    });

    it('receiptFrom+receiptTo narrows to a single product', async () => {
      const res = await get(
        '/products?receiptFrom=2026-02-01&receiptTo=2026-02-28',
      ).expect(200);
      expect(res.body.count).toBe(1);
      expect((res.body.rows as ProductRow[])[0].ean).toBe(EAN_GENERIC_MISSING);
    });

    it('400s on a non-date receiptFrom (DTO regex)', async () => {
      await get('/products?receiptFrom=not-a-date').expect(400);
    });
  });

  describe('GET /products perPage clamp', () => {
    it('clamps perPage to the 200 maximum', async () => {
      const res = await get('/products?perPage=200').expect(200);
      expect(res.body.perPage).toBe(200);
    });
  });

  describe('GET /products/crossed', () => {
    it('carries the active flag and competitors[] with null prices (no shared_catalog rows)', async () => {
      const res = await get(`/products/crossed?eans=${EAN_ACTIVE}`).expect(200);
      expect(res.body.count).toBe(1);
      const row = res.body.rows[0] as Record<string, unknown>;
      expect(row.ean).toBe(EAN_ACTIVE);
      expect(typeof row.active).toBe('boolean');
      expect(row.active).toBe(true);
      expect(row.competitors).toEqual([
        {
          origin: 'DROGAL',
          price: null,
          observation: null,
          isPbm: false,
          van: null,
        },
        {
          origin: 'DROGASIL',
          price: null,
          observation: null,
          isPbm: false,
          van: null,
        },
      ]);
      expect(row).not.toHaveProperty('DROGAL__price');
      expect(row).not.toHaveProperty('DROGASIL__price');
    });
  });

  describe('GET /products/strategic-price', () => {
    it('returns only the product with deals', async () => {
      const res = await get('/products/strategic-price').expect(200);
      expect(res.body.count).toBe(1);
      const row = res.body.rows[0] as Record<string, unknown>;
      expect(row.ean).toBe(EAN_ACTIVE);
      expect(row.deals).toEqual({ caderno: 'promo' });
    });
  });

  describe('GET /products/generic-missing-active-ingredients', () => {
    it('returns only the generic product missing an active ingredient', async () => {
      const res = await get(
        '/products/generic-missing-active-ingredients',
      ).expect(200);
      expect(res.body.count).toBe(1);
      expect((res.body.rows as ProductRow[])[0].ean).toBe(EAN_GENERIC_MISSING);
    });
  });

  describe('GET /products/stock + /products/stock-metrics', () => {
    it('returns own stock and OK status for a product with stock and no competitors', async () => {
      const res = await get(`/products/stock?eans=${EAN_ACTIVE}`).expect(200);
      expect(res.body.count).toBe(1);
      const row = res.body.rows[0] as Record<string, unknown>;
      expect(row.ean).toBe(EAN_ACTIVE);
      expect(Number(row.ownStock)).toBe(7);
      expect(row.stockStatus).toBe('OK');
    });

    it('counts the product as having own stock and no competitor stock', async () => {
      const res = await get(
        `/products/stock-metrics?eans=${EAN_ACTIVE}`,
      ).expect(200);
      expect(res.body).toEqual({
        total: 1,
        ownWithStock: 1,
        competitorsWithStock: [
          { origin: 'DROGAL', withStock: 0 },
          { origin: 'DROGASIL', withStock: 0 },
        ],
      });
    });
  });
});
