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
 * E2E for the saved offer-book-rules surface (CRUD + saved preview + products +
 * CSV + execution reports). Boots the real AppModule against the local DB so it
 * exercises the rebuild-offer-book-rules migration, the tenant search_path, the
 * role guards, and the real SQL of every endpoint. The price engine itself is
 * unit-tested; here we prove persistence + wiring. (execute / ERP write-back is
 * a separate pass and not covered.)
 */
const SLUG = 'e2eobr';
const SCHEMA = 'tenant_e2eobr';
const ROOT_ID = '33333333-3333-3333-3333-333333333331';
const CHILD_ID = '33333333-3333-3333-3333-333333333332';
const EAN_A = '7893111111111';
const EAN_B = '7893222222222';

const a7 = { changePrices: jest.fn(), upsertOffer: jest.fn() };
const credentials = { baseUrl: 'https://erp.test', apiKey: 'key' };

describe('Offer Book Rules (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  const post = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .get(path)
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

    await ds.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await ds.query(
      `INSERT INTO core.tenant (slug, name, schema_name, status)
       VALUES ($1, $1, $2, 'active') ON CONFLICT (slug) DO NOTHING`,
      [SLUG, SCHEMA],
    );
    const hash = await argon2.hash('secret123');
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ($1, 'admin@obr.test', $2, 'admin', 'active'),
              ($1, 'op@obr.test', $2, 'operator', 'active'),
              ($1, 'viewer@obr.test', $2, 'viewer', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [SLUG, hash],
    );

    execSync(`npm run migration:tenant ${SLUG}`, { stdio: 'inherit' });

    await ds.query(
      `INSERT INTO ${SCHEMA}.classification (id, name, parent_id, visible) VALUES
        ($1, 'GENERICO', NULL, true),
        ($2, 'ANALGESICOS', $1, true)`,
      [ROOT_ID, CHILD_ID],
    );
    await ds.query(
      `INSERT INTO ${SCHEMA}.product
         (ean, name, active, price, cost, margin, classification_id, external_id, monitored, generic, status) VALUES
        (${EAN_A}, 'Dipirona 500mg', true, 10.00, 5.0000, 50.0000, $1, '5001', false, true, 'OK'),
        (${EAN_B}, 'Dipirona 1g',    true,  8.00, 4.0000, 50.0000, $1, '5002', false, true, 'OK')`,
      [CHILD_ID],
    );

    const login = async (email: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'secret123', tenantSlug: SLUG })
        .expect(200);
      return res.body.accessToken as string;
    };
    adminToken = await login('admin@obr.test');
    operatorToken = await login('op@obr.test');
    viewerToken = await login('viewer@obr.test');
  }, 90000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await ds.query(`DELETE FROM core."user" WHERE tenant_id = $1`, [SLUG]);
      await ds.query(`DELETE FROM core.tenant WHERE slug = $1`, [SLUG]);
    }
    await app?.close();
  });

  let ruleId: string;

  it('creates a rule targeting a classification (operator)', async () => {
    const res = await post('/offer-book-rules', operatorToken)
      .send({
        name: 'Desconto genéricos',
        calculationBaseType: 'SALE_PRICE',
        classifications: ['GENERICO'],
        pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 10 }],
        priceLocks: [{ minMargin: 20 }],
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.classifications).toEqual(['GENERICO']);
    expect(res.body.pricingRules).toHaveLength(1);
    expect(res.body.priceLocks).toHaveLength(1);
    ruleId = res.body.id;
  });

  it('rejects targeting by both eans and classifications', async () => {
    await post('/offer-book-rules', operatorToken)
      .send({
        name: 'bad',
        calculationBaseType: 'SALE_PRICE',
        eans: ['7893111111111'],
        classifications: ['GENERICO'],
        pricingRules: [],
        priceLocks: [],
      })
      .expect(400);
  });

  it('forbids a viewer from creating', async () => {
    await post('/offer-book-rules', viewerToken)
      .send({
        name: 'x',
        calculationBaseType: 'SALE_PRICE',
        classifications: ['GENERICO'],
        pricingRules: [],
        priceLocks: [],
      })
      .expect(403);
  });

  it('lists rules and filters by name', async () => {
    const all = await get('/offer-book-rules').expect(200);
    expect(all.body.count).toBeGreaterThanOrEqual(1);
    const filtered = await get('/offer-book-rules?name=genéricos').expect(200);
    expect(filtered.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('gets a rule by id (404 for unknown)', async () => {
    const res = await get(`/offer-book-rules/${ruleId}`).expect(200);
    expect(res.body.name).toBe('Desconto genéricos');
    await get('/offer-book-rules/44444444-4444-4444-4444-444444444444').expect(
      404,
    );
  });

  it('previews a saved rule (engine runs over the targeted products)', async () => {
    const res = await get(`/offer-book-rules/${ruleId}/preview`).expect(200);
    expect(res.body.count).toBe(2);
    const a = res.body.rows.find((r: { ean: string }) => r.ean === EAN_A);
    expect(a.currentPrice).toBe(10);
    expect(a.finalPrice).toBe(9); // 10% discount, margin 50% stays above the 20% lock
  });

  it('lists the products a saved rule targets', async () => {
    const res = await get(`/offer-book-rules/${ruleId}/products`).expect(200);
    expect(res.body.count).toBe(2);
    expect(res.body.rows[0]).toHaveProperty('currentPrice');
    expect(res.body.rows[0]).not.toHaveProperty('finalPrice');
  });

  it('downloads the saved-rule preview as CSV', async () => {
    const res = await get(
      `/offer-book-rules/${ruleId}/preview-download`,
    ).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('EAN');
    expect(res.text.split('\n')).toHaveLength(3); // header + 2 rows
  });

  it('downloads an ad-hoc preview as CSV (operator)', async () => {
    const res = await post('/offer-book-rules/preview-download', operatorToken)
      .send({
        calculationBaseType: 'SALE_PRICE',
        classifications: ['GENERICO'],
        pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 5 }],
        priceLocks: [],
      })
      .expect(201);
    expect(res.text.split('\n')[0]).toContain('Preco Final');
  });

  it('updates a rule (replaces pricing rules)', async () => {
    const res = await patch(`/offer-book-rules/${ruleId}`, operatorToken)
      .send({ pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 25 }] })
      .expect(200);
    expect(res.body.pricingRules[0].percentageValue).toBe(25);
    const preview = await get(`/offer-book-rules/${ruleId}/preview`).expect(
      200,
    );
    const a = preview.body.rows.find((r: { ean: string }) => r.ean === EAN_A);
    // 25% off 10 = 7.5; newMargin = (7.5-5)/7.5 = 33% >= the 20% lock → lock stays off
    expect(a.priceLockApplied).toBe(false);
    expect(a.finalPrice).toBe(7.5);
  });

  it('serves execution reports (list / by-rule / single with items)', async () => {
    const reportId = '55555555-5555-5555-5555-555555555551';
    await ds.query(
      `INSERT INTO ${SCHEMA}.offer_book_rule_execution_report
         (id, rule_id, execution_type, calculation_base_type, started_at, finished_at,
          total_products, products_updated, products_skipped, outcome)
       VALUES ($1, $2, 'MANUAL', 'SALE_PRICE', now(), now(), 2, 1, 1, 'SUCCESS')`,
      [reportId, ruleId],
    );
    await ds.query(
      `INSERT INTO ${SCHEMA}.offer_book_rule_execution_report_item
         (report_id, ean, name, final_price, was_updated) VALUES
        ($1, ${EAN_A}, 'Dipirona 500mg', 9.00, true),
        ($1, ${EAN_B}, 'Dipirona 1g', 7.20, false)`,
      [reportId],
    );

    const list = await get(
      '/offer-book-rules/execution-reports?outcome=SUCCESS',
    ).expect(200);
    expect(list.body.count).toBe(1);
    expect(list.body.rows[0].productsUpdated).toBe(1);

    const byRule = await get(
      `/offer-book-rules/${ruleId}/execution-reports`,
    ).expect(200);
    expect(byRule.body.count).toBe(1);

    const single = await get(
      `/offer-book-rules/execution-reports/${reportId}`,
    ).expect(200);
    expect(single.body.outcome).toBe('SUCCESS');
    expect(single.body.items.count).toBe(2);
    const filtered = await get(
      `/offer-book-rules/execution-reports/${reportId}?name=500mg`,
    ).expect(200);
    expect(filtered.body.items.count).toBe(1);
  });

  it('forbids an operator from deleting, allows admin (cascade)', async () => {
    await del(`/offer-book-rules/${ruleId}`, operatorToken).expect(403);
    await del(`/offer-book-rules/${ruleId}`, adminToken).expect(200);
    await get(`/offer-book-rules/${ruleId}`).expect(404);
    const [{ count }]: Array<{ count: string }> = await ds.query(
      `SELECT count(*)::int AS count FROM ${SCHEMA}.offer_book_rule_execution_report WHERE rule_id = $1`,
      [ruleId],
    );
    expect(Number(count)).toBe(0); // FK cascade dropped the report too
  });
});
