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
 * End-to-end coverage for POST /offer-book-rules/preview. The pricing math is
 * exhaustively unit-tested (offer-book-rules.service.spec.ts); this proves the
 * parts a unit test can't: the controller + Roles guard, the per-request
 * tenant EntityManager, DTO validation, and the real fetchProducts SQL
 * (recursive classification CTE + offer_book join) against a migrated schema.
 * Only the external ERP (A7Pharma) is mocked so the AppModule boots.
 */
const SLUG = 'e2eobr';
const SCHEMA = 'tenant_e2eobr';
// Must be UUID v4 — PreviewOfferBookRulesDto uses @IsUUID('4').
const ROOT_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const EAN_A = '7893333333333';
const EAN_B = '7894444444444';

const a7 = { changePrices: jest.fn(), upsertOffer: jest.fn() };
const credentials = { baseUrl: 'https://erp.test', apiKey: 'key' };

interface PreviewRow {
  ean: string;
  classification: string;
  currentPrice: number;
  finalPrice: number;
  actionType: string | null;
  percentageValue: number;
  priceLockApplied: boolean;
}
interface PreviewBody {
  rows: PreviewRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

describe('Offer book rules preview (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let operatorToken: string;

  const post = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .post(path)
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
       VALUES ($1, 'admin@e2e.test', $2, 'admin', 'active'),
              ($1, 'op@e2e.test', $2, 'operator', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [SLUG, hash],
    );

    // Real production tenant DDL — never hand-write the tenant tables.
    execSync(`npm run migration:tenant ${SLUG}`, { stdio: 'inherit' });

    // Two-level classification so the recursive CTE rebuilds the ">"-joined
    // path "Genéricos > Analgésicos" that the classification preview path
    // matches on.
    await ds.query(
      `INSERT INTO ${SCHEMA}.classification (id, name, parent_id, visible) VALUES
        ($1, 'Genéricos', NULL, true),
        ($2, 'Analgésicos', $1, true)`,
      [ROOT_ID, CHILD_ID],
    );
    await ds.query(
      `INSERT INTO ${SCHEMA}.product
         (ean, name, active, price, cost, margin,
          classification_id, external_id, monitored, status) VALUES
        (${EAN_A}, 'Dipirona 500mg', true, 10.00, 5.0000, 50.0000, $1, '6001', false, 'OK'),
        (${EAN_B}, 'Dipirona 1g',  true,  8.00, 5.0000, 37.5000, $1, '6002', false, 'OK')`,
      [CHILD_ID],
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
    // Use the module constants (not values captured during the test) so
    // cleanup still runs fully even if beforeAll aborted partway — no leaked
    // schema/rows.
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await ds.query(`DELETE FROM core."user" WHERE tenant_id = $1`, [SLUG]);
      await ds.query(`DELETE FROM core.tenant WHERE slug = $1`, [SLUG]);
    }
    await app?.close();
  });

  it('401s without a token', async () => {
    await request(app.getHttpServer())
      .post('/offer-book-rules/preview')
      .send({
        calculationBaseType: 'SALE_PRICE',
        eans: [EAN_A],
        pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 10 }],
        priceLocks: [],
      })
      .expect(401);
  });

  it('previews a 10% discount off the sale price for the targeted eans', async () => {
    const res = await post('/offer-book-rules/preview')
      .send({
        calculationBaseType: 'SALE_PRICE',
        eans: [EAN_A],
        pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 10 }],
        priceLocks: [],
      })
      .expect(201);

    const body = res.body as PreviewBody;
    expect(body.total).toBe(1);
    expect(body.rows).toHaveLength(1);
    const row = body.rows[0];
    expect(row.ean).toBe(EAN_A);
    expect(row.classification).toBe('Genéricos > Analgésicos');
    expect(row.currentPrice).toBe(10);
    expect(row.actionType).toBe('DISCOUNT');
    expect(row.percentageValue).toBe(10);
    expect(row.priceLockApplied).toBe(false);
    expect(row.finalPrice).toBeLessThan(row.currentPrice);
  });

  it('matches by classification id subtree as an operator', async () => {
    const res = await post('/offer-book-rules/preview', operatorToken)
      .send({
        calculationBaseType: 'SALE_PRICE',
        classifications: [ROOT_ID],
        pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 10 }],
        priceLocks: [],
      })
      .expect(201);

    const body = res.body as PreviewBody;
    expect(body.total).toBe(2);
    expect(body.rows.map((r) => r.ean).sort()).toEqual([EAN_A, EAN_B]);
    for (const row of body.rows)
      expect(row.finalPrice).toBeLessThan(row.currentPrice);
  });

  it('400s when both eans and classifications are sent (service guard)', async () => {
    await post('/offer-book-rules/preview')
      .send({
        calculationBaseType: 'SALE_PRICE',
        eans: [EAN_A],
        classifications: [ROOT_ID],
        pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 10 }],
        priceLocks: [],
      })
      .expect(400);
  });

  it('400s on a percentageValue above 100 (DTO validation)', async () => {
    await post('/offer-book-rules/preview')
      .send({
        calculationBaseType: 'SALE_PRICE',
        eans: [EAN_A],
        pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 150 }],
        priceLocks: [],
      })
      .expect(400);
  });
});
