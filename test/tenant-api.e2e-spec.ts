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
 * End-to-end coverage for the tenant-facing API. Unlike the unit specs
 * (which mock em.query), this boots the real AppModule against a real DB to
 * exercise the bits no unit test can: the per-request tenant search_path,
 * the cross-schema joins into shared_catalog, role guards, and the real
 * SQL/DDL of every endpoint. Only the external ERP (A7Pharma) is mocked.
 *
 * Requires the same already-migrated local DB + broker as the other e2e
 * specs (NODE_ENV=development, core + shared_catalog migrated). The tenant
 * schema is created, migrated and dropped per run, so it is self-contained.
 */
const SLUG = 'e2ecatalog';
const SCHEMA = 'tenant_e2ecatalog';
const ROOT_ID = '11111111-1111-1111-1111-111111111111';
const CHILD_ID = '22222222-2222-2222-2222-222222222222';
const EAN_A = '7891111111111';
const EAN_B = '7892222222222';

const a7 = { changePrices: jest.fn(), upsertOffer: jest.fn() };
const credentials = { baseUrl: 'https://erp.test', apiKey: 'key' };

describe('Tenant API (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let operatorToken: string;

  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const post = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
  const patch = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`);
  const del = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .delete(path)
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

    // Tenant + users in core.
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

    // Tenant schema: run the real, production tenant-migration script
    // (resolves schema_name from the core.tenant row inserted above), then
    // seed. Delegating to the script keeps the DDL identical to prod.
    execSync(`npm run migration:tenant ${SLUG}`, { stdio: 'inherit' });

    await ds.query(
      `INSERT INTO ${SCHEMA}.classification (id, name, parent_id, visible) VALUES
        ($1, 'Genéricos', NULL, true),
        ($2, 'Analgésicos', $1, true)`,
      [ROOT_ID, CHILD_ID],
    );
    await ds.query(
      `INSERT INTO ${SCHEMA}.product
         (ean, name, active, price, cost, classification_id,
          external_id, monitored, status) VALUES
        (${EAN_A}, 'Dipirona 500mg', true, 10.00, 5.0000, $1, '5001', false, 'OK'),
        (${EAN_B}, 'Dipirona 1g',  true,  8.00, 5.0000, NULL, '5002', false, 'OK')`,
      [ROOT_ID],
    );
    // Identity (princípio ativo, generic) agora vem do cadastro interno —
    // shared_catalog.base_product — cruzado por EAN nas leituras do tenant.
    // A tabela é cross-tenant: limpar antes de semear e no afterAll.
    await ds.query(
      `DELETE FROM shared_catalog.base_product WHERE ean IN (${EAN_A}, ${EAN_B})`,
    );
    await ds.query(
      `INSERT INTO shared_catalog.base_product
         (ean, description, active_ingredient, generic) VALUES
        (${EAN_A}, 'Dipirona 500mg', 'DIPIRONA', true),
        (${EAN_B}, 'Dipirona 1g', 'DIPIRONA', true)`,
    );
    await ds.query(
      `INSERT INTO ${SCHEMA}.product_stock (ean, store_external_id, quantity) VALUES
        (${EAN_A}, 1, 3), (${EAN_B}, 1, 5)`,
    );
    await ds.query(
      `INSERT INTO ${SCHEMA}.offer_book (ean, target_price, external_id) VALUES
        (${EAN_B}, 7.25, 501)`,
    );
    // One in-window, one expired, one inactive — only the first is "vigente",
    // so GET /offer-campaigns proves the active + date-window filter (not just
    // that an empty table returns []).
    await ds.query(
      `INSERT INTO ${SCHEMA}.tenant_offer_campaign
         (external_id, name, active, start_date, expiration_date) VALUES
        (501, 'Caderno Ativo',    true,  now() - interval '1 day',  now() + interval '7 days'),
        (502, 'Caderno Expirado', true,  now() - interval '30 days', now() - interval '1 day'),
        (503, 'Caderno Inativo',  false, now() - interval '1 day',  now() + interval '7 days')`,
    );
    // shared_catalog is cross-tenant; clear any leftover competitor rows for
    // these synthetic EANs so the cross-schema "no competitor" path is
    // deterministic regardless of prior DB state.
    await ds.query(
      `DELETE FROM shared_catalog.product WHERE ean IN (${EAN_A}, ${EAN_B})`,
    );

    const login = async (email: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'secret123', tenantSlug: SLUG })
        .expect(200);
      return (res.body as { accessToken: string }).accessToken;
    };
    adminToken = await login('admin@e2e.test');
    operatorToken = await login('op@e2e.test');
  }, 60000);

  afterAll(async () => {
    // Resolve the tenant id here (not from a beforeAll var) so cleanup still
    // runs fully even if beforeAll aborted partway — no leaked schema/rows.
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await ds.query(
        `DELETE FROM shared_catalog.base_product WHERE ean IN (${EAN_A}, ${EAN_B})`,
      );
      const rows: Array<{ id: string }> = await ds.query(
        `SELECT id FROM core.tenant WHERE slug = $1`,
        [SLUG],
      );
      const id = rows[0]?.id;
      if (id) {
        await ds.query(
          `DELETE FROM core.price_rounding_rule WHERE tenant_id = $1`,
          [id],
        );
        await ds.query(
          `DELETE FROM core.price_rounding_range WHERE tenant_id = $1`,
          [id],
        );
        await ds.query(
          `DELETE FROM core.status_settings WHERE tenant_id = $1`,
          [id],
        );
      }
      await ds.query(`DELETE FROM core."user" WHERE tenant_id = $1`, [SLUG]);
      await ds.query(`DELETE FROM core.tenant WHERE slug = $1`, [SLUG]);
    }
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('auth boundary', () => {
    it('401s on a tenant route without a token', async () => {
      await request(app.getHttpServer()).get('/products').expect(401);
    });
  });

  describe('GET /products (tenant-scoped read)', () => {
    it('returns the seeded products from this tenant schema', async () => {
      const res = await get('/products').expect(200);
      expect(res.body.count).toBe(2);
      const eans = res.body.rows.map((r: { ean: string }) => r.ean).sort();
      expect(eans).toEqual([EAN_A, EAN_B]);
    });
  });

  describe('GET /products/active-ingredients', () => {
    it('lists the distinct active ingredients', async () => {
      const res = await get('/products/active-ingredients').expect(200);
      expect(res.body.activeIngredients).toEqual(['DIPIRONA']);
    });
  });

  describe('GET /products/active-ingredients/crossed (cross-schema + decision)', () => {
    it('groups by ingredient, picks the cheapest in-stock combate', async () => {
      const res = await get(
        '/products/active-ingredients/crossed?store=1&tolerance=0',
      ).expect(200);
      expect(res.body.count).toBe(1);
      const g = res.body.rows[0];
      expect(g.activeIngredient).toBe('DIPIRONA');
      expect(g.combate.ean).toBe(EAN_B); // 8.00 < 10.00, both in stock
      expect(g.combate.price).toBe(8);
      expect(g.targetPrice).toBe(8);
      expect(g.priceOffer).toBe(7.25);
      expect(g.decision).toBe('ok'); // no competitor in shared_catalog
    });

    it('400s without a store', async () => {
      await get('/products/active-ingredients/crossed').expect(400);
    });
  });

  describe('GET /classifications/grouped', () => {
    it('nests roots with their children', async () => {
      const res = await get('/classifications/grouped').expect(200);
      const root = res.body.find(
        (c: { name: string }) => c.name === 'Genéricos',
      );
      expect(root.children.map((c: { name: string }) => c.name)).toEqual([
        'Analgésicos',
      ]);
    });
  });

  describe('PATCH /products/:ean', () => {
    it('updates an editable field and persists it', async () => {
      await patch(`/products/${EAN_A}`)
        .send({ supplier: 'EMS' })
        .expect(200)
        .expect((r) => expect(r.body).toEqual({ ean: EAN_A, updated: 1 }));
      const res = await get(`/products?eans=${EAN_A}`).expect(200);
      expect(res.body.rows[0].supplier).toBe('EMS');
    });

    it('400s on a non-numeric ean', async () => {
      await patch('/products/abc').send({ supplier: 'X' }).expect(400);
    });
  });

  describe('POST/DELETE /products/:ean/offer (write-back)', () => {
    it('pushes the offer to the ERP and mirrors offer_book', async () => {
      await post(`/products/${EAN_A}/offer`)
        .send({ targetPrice: 7.5, cadernoId: 99, description: 'promo' })
        .expect(201)
        .expect((r) =>
          expect(r.body).toEqual({
            ean: EAN_A,
            targetPrice: 7.5,
            cadernoId: 99,
          }),
        );
      expect(a7.upsertOffer).toHaveBeenCalledWith(credentials, 99, [
        { idEmbalagem: 5001, precoOferta: 7.5 },
      ]);
      const [row] = await ds.query(
        `SELECT target_price AS "targetPrice", external_id AS "externalId"
           FROM ${SCHEMA}.offer_book WHERE ean = ${EAN_A}`,
      );
      expect(row).toEqual({ targetPrice: '7.50', externalId: '99' });
    });

    it('clears the offer on the ERP and drops the local row', async () => {
      await del(`/products/${EAN_A}/offer`)
        .expect(200)
        .expect((r) => expect(r.body).toEqual({ ean: EAN_A, deleted: true }));
      expect(a7.upsertOffer).toHaveBeenCalledWith(credentials, 99, [
        { idEmbalagem: 5001, precoOferta: null },
      ]);
      const rows = await ds.query(
        `SELECT 1 FROM ${SCHEMA}.offer_book WHERE ean = ${EAN_A}`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('settings/variation-status (core, via resolveTenantId)', () => {
    it('PATCH merges the sent field; GET reflects it', async () => {
      await patch('/settings/variation-status')
        .send({ attentionAbove: 30 })
        .expect(200)
        .expect((r) => expect(r.body.attentionAbove).toBe(30));
      const res = await get('/settings/variation-status').expect(200);
      expect(res.body.attentionAbove).toBe(30);
      expect(res.body.suspectBelow).toBe(-15); // default preserved
    });

    it('403s for a non-admin', async () => {
      await patch('/settings/variation-status', operatorToken)
        .send({ attentionAbove: 1 })
        .expect(403);
    });
  });

  describe('configurations/price-rounding', () => {
    it('creates a band with rules and lists it', async () => {
      const created = await post('/configurations/price-rounding')
        .send({
          priceMin: 0,
          priceMax: 10,
          rules: [{ decimalMin: 0, decimalMax: 0.49, roundTo: 0.49 }],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        priceMin: 0,
        priceMax: 10,
        rules: [{ decimalMin: 0, decimalMax: 0.49, roundTo: 0.49 }],
      });
      const list = await get('/configurations/price-rounding').expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('400s on an inverted band', async () => {
      await post('/configurations/price-rounding')
        .send({ priceMin: 10, priceMax: 5 })
        .expect(400);
    });
  });

  describe('GET /offer-campaigns', () => {
    it('returns only active, in-window campaigns', async () => {
      const res = await get('/offer-campaigns').expect(200);
      expect(res.body).toEqual([{ id: 501, name: 'Caderno Ativo' }]);
    });
  });
});
