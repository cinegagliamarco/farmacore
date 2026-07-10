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
import { ExecuteOfferBookRuleStep } from '../src/pipeline/steps/execute-offer-book-rule.step';
import { TenantTransactionService } from '../src/tenant/tenant-transaction.service';

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
const CADERNO_ID = 47;
const CADERNO_ID_2 = 48;

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
  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .get(path)
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
    // `offer-book-rules` module granted so the @RequireModule gate lets the
    // routes through (core.tenant.modules defaults to '{}').
    await ds.query(
      `INSERT INTO core.tenant (slug, name, schema_name, status, modules)
       VALUES ($1, $1, $2, 'active', ARRAY['offer-book-rules'])
       ON CONFLICT (slug) DO UPDATE SET modules = EXCLUDED.modules`,
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
    // Cadernos de ofertas vigentes que as regras vão aplicar (external_id).
    await ds.query(
      `INSERT INTO ${SCHEMA}.tenant_offer_campaign (external_id, name, active)
       VALUES (${CADERNO_ID}, 'KIT PERFUMARIA', true),
              (${CADERNO_ID_2}, 'SEMANA DO CLIENTE', true)`,
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

  // CRUD da regra persistida (Fase 2): exercita a migration realinhada, o
  // cascade dos filhos (pricingRules/priceLocks/eans) e o join do caderno —
  // o que o unit test com `em` mockado não prova.
  describe('persisted rule CRUD', () => {
    let ruleId: string;

    const createBody = {
      offerBookInfoId: CADERNO_ID,
      calculationBaseType: 'SALE_PRICE',
      eans: [EAN_B, EAN_A],
      pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 5 }],
      priceLocks: [{ classifications: [CHILD_ID], minMargin: 20 }],
      scheduleEnabled: true,
      scheduledDays: [0, 3],
    };

    it('404s creating a rule for an unknown caderno', async () => {
      await post('/offer-book-rules')
        .send({ ...createBody, offerBookInfoId: 9999 })
        .expect(404);
    });

    it('creates the rule applied to the caderno', async () => {
      const res = await post('/offer-book-rules').send(createBody).expect(201);
      ruleId = (res.body as { id: string }).id;
      expect(ruleId).toBeTruthy();
    });

    it('round-trips the rule with children and the caderno name', async () => {
      const res = await get(`/offer-book-rules/${ruleId}`).expect(200);
      const body = res.body as {
        offerBookInfoId: number;
        cadernoName: string;
        calculationBaseType: string;
        scheduleEnabled: boolean;
        scheduledDays: number[];
        productsCount: number;
        eans: string[];
        pricingRules: { actionType: string; percentageValue: number }[];
        priceLocks: { classifications: string[]; minMargin: number }[];
      };
      expect(body.offerBookInfoId).toBe(CADERNO_ID);
      expect(body.cadernoName).toBe('KIT PERFUMARIA');
      expect(body.calculationBaseType).toBe('SALE_PRICE');
      expect(body.scheduleEnabled).toBe(true);
      expect(body.scheduledDays).toEqual([0, 3]);
      expect(body.productsCount).toBe(2);
      expect(body.eans).toEqual([EAN_A, EAN_B]); // sorted
      expect(body.pricingRules).toHaveLength(1);
      expect(body.pricingRules[0].actionType).toBe('DISCOUNT');
      expect(body.pricingRules[0].percentageValue).toBe(5);
      expect(body.priceLocks).toHaveLength(1);
      expect(body.priceLocks[0].classifications).toEqual([CHILD_ID]);
      expect(body.priceLocks[0].minMargin).toBe(20);
    });

    it('lists the rule with caderno name and product count', async () => {
      const res = await get('/offer-book-rules').expect(200);
      const body = res.body as {
        rows: {
          id: string;
          cadernoName: string;
          productsCount: number;
        }[];
        total: number;
      };
      const row = body.rows.find((r) => r.id === ruleId);
      expect(row).toBeDefined();
      expect(row!.cadernoName).toBe('KIT PERFUMARIA');
      expect(row!.productsCount).toBe(2);
    });

    it('409s creating a second rule for the same caderno', async () => {
      await post('/offer-book-rules').send(createBody).expect(409);
    });

    it('deletes the rule, then 404s on fetch', async () => {
      await del(`/offer-book-rules/${ruleId}`).expect(200);
      await get(`/offer-book-rules/${ruleId}`).expect(404);
    });
  });

  // Execução (Fase 3): o POST congela os preços como items pending; o step do
  // worker (dirigido aqui direto, com a A7 mockada) empurra em lote, espelha e
  // finaliza report + status da regra — tudo contra o schema migrado real.
  describe('rule execution', () => {
    let ruleId: string;
    let reportId: string;

    const runStep = async (): Promise<void> => {
      const step = app.get(ExecuteOfferBookRuleStep);
      const tx = app.get(TenantTransactionService);
      await tx.runWithTenant(SCHEMA, (em) => step.run(em, SLUG, reportId));
    };

    it('404s executing an unknown rule', async () => {
      await post(
        '/offer-book-rules/99999999-9999-4999-8999-999999999999/execute',
      ).expect(404);
    });

    it('202s the execute with a reportId (prices frozen as pending items)', async () => {
      const created = await post('/offer-book-rules')
        .send({
          offerBookInfoId: CADERNO_ID,
          calculationBaseType: 'SALE_PRICE',
          eans: [EAN_A, EAN_B],
          pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 5 }],
          priceLocks: [],
        })
        .expect(201);
      ruleId = (created.body as { id: string }).id;

      const res = await post(`/offer-book-rules/${ruleId}/execute`).expect(202);
      reportId = (res.body as { reportId: string }).reportId;
      expect(reportId).toBeTruthy();
    });

    it('409s a concurrent execute while the rule is RUNNING', async () => {
      await post(`/offer-book-rules/${ruleId}/execute`).expect(409);
    });

    it('worker pushes the frozen prices to A7 in one batch and finalizes SUCCESS', async () => {
      a7.upsertOffer.mockClear();
      await runStep();

      expect(a7.upsertOffer).toHaveBeenCalledTimes(1);
      const [creds, caderno, items] = a7.upsertOffer.mock.calls[0] as [
        unknown,
        number,
        { idEmbalagem: number; precoOferta: number }[],
      ];
      expect(creds).toEqual(credentials);
      expect(caderno).toBe(CADERNO_ID);
      expect(items).toEqual([
        { idEmbalagem: 6001, precoOferta: 9.5 },
        { idEmbalagem: 6002, precoOferta: 7.6 },
      ]);

      const rule = await get(`/offer-book-rules/${ruleId}`).expect(200);
      expect((rule.body as { status: string }).status).toBe('SUCCEEDED');

      const list = await get(
        `/offer-book-rules/${ruleId}/execution-reports`,
      ).expect(200);
      const listBody = list.body as {
        total: number;
        rows: {
          id: string;
          outcome: string;
          executionType: string;
          totalProducts: number;
          productsUpdated: number;
          productsSkipped: number;
        }[];
      };
      expect(listBody.total).toBe(1);
      expect(listBody.rows[0].id).toBe(reportId);
      expect(listBody.rows[0].outcome).toBe('SUCCESS');
      expect(listBody.rows[0].executionType).toBe('MANUAL');
      expect(listBody.rows[0].totalProducts).toBe(2);
      expect(listBody.rows[0].productsUpdated).toBe(2);
      expect(listBody.rows[0].productsSkipped).toBe(0);

      const det = await get(
        `/offer-book-rules/execution-reports/${reportId}?page=1&perPage=50`,
      ).expect(200);
      const detBody = det.body as {
        totalItems: number;
        items: {
          ean: string;
          finalPrice: number;
          applyStatus: string;
          wasUpdated: boolean;
        }[];
      };
      expect(detBody.totalItems).toBe(2);
      for (const item of detBody.items) {
        expect(item.applyStatus).toBe('applied');
        expect(item.wasUpdated).toBe(true);
      }
      expect(detBody.items.map((i) => i.finalPrice)).toEqual([9.5, 7.6]);

      // Espelho local pós-push: offer_book global aponta pro caderno escrito.
      const mirror: Array<{ ean: string; tp: string; ext: string }> =
        await ds.query(
          `SELECT ean::text AS ean, target_price AS tp, external_id::text AS ext
             FROM ${SCHEMA}.offer_book ORDER BY ean`,
        );
      expect(mirror).toHaveLength(2);
      expect(mirror.map((m) => Number(m.tp))).toEqual([9.5, 7.6]);
      expect(mirror.every((m) => m.ext === String(CADERNO_ID))).toBe(true);
    });

    it('redelivery does not re-push applied items', async () => {
      a7.upsertOffer.mockClear();
      await runStep();
      expect(a7.upsertOffer).not.toHaveBeenCalled();
    });

    it('400s the report detail without required pagination', async () => {
      await get(`/offer-book-rules/execution-reports/${reportId}`).expect(400);
    });

    it('total A7 failure → report FAILURE, rule ERRORED, items erro_transitorio', async () => {
      a7.upsertOffer.mockClear();
      a7.upsertOffer.mockRejectedValueOnce(new Error('erp down'));

      const res = await post(`/offer-book-rules/${ruleId}/execute`).expect(202);
      reportId = (res.body as { reportId: string }).reportId;
      await runStep();

      const rule = await get(`/offer-book-rules/${ruleId}`).expect(200);
      expect((rule.body as { status: string }).status).toBe('ERRORED');

      const det = await get(
        `/offer-book-rules/execution-reports/${reportId}?page=1&perPage=50`,
      ).expect(200);
      const detBody = det.body as {
        report: { outcome: string; errorMessage: string | null };
        items: { applyStatus: string; applyError: string | null }[];
      };
      expect(detBody.report.outcome).toBe('FAILURE');
      expect(detBody.report.errorMessage).toContain('falharam');
      for (const item of detBody.items) {
        expect(item.applyStatus).toBe('failed');
        expect(item.applyError).toBe('erro_transitorio');
      }
    });

    it('global report list filters by outcome and ruleId', async () => {
      const failures = await get(
        `/offer-book-rules/execution-reports?outcome=FAILURE&ruleId=${ruleId}`,
      ).expect(200);
      const fBody = failures.body as { rows: { id: string }[] };
      expect(fBody.rows.some((r) => r.id === reportId)).toBe(true);

      const successes = await get(
        `/offer-book-rules/execution-reports?outcome=SUCCESS&ruleId=${ruleId}`,
      ).expect(200);
      const sBody = successes.body as {
        rows: { id: string; outcome: string }[];
      };
      expect(sBody.rows.every((r) => r.outcome === 'SUCCESS')).toBe(true);
      expect(sBody.rows.some((r) => r.id === reportId)).toBe(false);
    });

    it('rule whose prices do not change → NO_CHANGES without any push', async () => {
      const created = await post('/offer-book-rules')
        .send({
          offerBookInfoId: CADERNO_ID_2,
          calculationBaseType: 'SALE_PRICE',
          eans: [EAN_A],
          pricingRules: [{ actionType: 'DISCOUNT', percentageValue: 0 }],
          priceLocks: [],
        })
        .expect(201);
      const noChangeRuleId = (created.body as { id: string }).id;

      const res = await post(
        `/offer-book-rules/${noChangeRuleId}/execute`,
      ).expect(202);
      reportId = (res.body as { reportId: string }).reportId;

      a7.upsertOffer.mockClear();
      await runStep();
      expect(a7.upsertOffer).not.toHaveBeenCalled();

      const rule = await get(`/offer-book-rules/${noChangeRuleId}`).expect(200);
      expect((rule.body as { status: string }).status).toBe('SUCCEEDED');

      const det = await get(
        `/offer-book-rules/execution-reports/${reportId}?page=1&perPage=10`,
      ).expect(200);
      const detBody = det.body as {
        report: { outcome: string; productsSkipped: number };
        items: { applyStatus: string }[];
      };
      expect(detBody.report.outcome).toBe('NO_CHANGES');
      expect(detBody.report.productsSkipped).toBe(1);
      expect(detBody.items[0].applyStatus).toBe('skipped');
    });
  });
});
