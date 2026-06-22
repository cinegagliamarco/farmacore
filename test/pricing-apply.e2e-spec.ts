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
import { ApplyPriceStep } from '../src/pipeline/steps/apply-price.step';
import { TenantTransactionService } from '../src/tenant/tenant-transaction.service';

/**
 * E2E da Fase 3 — aplicar preço em massa. Cobre o contrato HTTP (POST revalida +
 * congela, GET reporta, idempotência) e o caminho do worker (ApplyPriceStep)
 * contra o DB real com a A7Pharma mockada: apply ok, skip de monitored e bloqueio
 * de campanha. A app HTTP roda sem consumers, então o step é exercitado direto.
 */
const SLUG = 'e2eapply';
const SCHEMA = 'tenant_e2eapply';
const EAN_OK = '7894444444444';
const EAN_MON = '7894444444445';
const EAN_CAMP = '7894444444446';
const a7 = { changePrices: jest.fn(), upsertOffer: jest.fn() };
const creds = { baseUrl: 'https://erp.test', apiKey: 'key' };

describe('Pricing apply (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let step: ApplyPriceStep;
  let tx: TenantTransactionService;

  const post = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
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
      .useValue({ getApiCredentials: jest.fn().mockResolvedValue(creds) })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);
    step = app.get(ApplyPriceStep);
    tx = app.get(TenantTransactionService);

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
    execSync(`npm run migration:tenant ${SLUG}`, { stdio: 'inherit' });

    // custo 6 → piso (sem regra) = custo. Tem external_id (A7) e não monitorado.
    await ds.query(
      `INSERT INTO ${SCHEMA}.product
         (ean, name, active, price, cost, external_id, monitored, status) VALUES
        (${EAN_OK},   'A', true, 8.00, 6.0000, '7001', false, 'OK'),
        (${EAN_MON},  'B', true, 8.00, 6.0000, '7002', true,  'OK'),
        (${EAN_CAMP}, 'C', true, 8.00, 6.0000, '7003', false, 'OK')`,
    );
    // EAN_CAMP num caderno (offer_book.external_id) com campanha ativa.
    await ds.query(
      `INSERT INTO ${SCHEMA}.offer_book (ean, description, target_price, external_id)
       VALUES (${EAN_CAMP}, 'promo', 7.00, 555)`,
    );
    await ds.query(
      `INSERT INTO ${SCHEMA}.tenant_offer_campaign
         (external_id, name, active, start_date, expiration_date)
       VALUES (555, 'Campanha', true, now() - interval '1 day', now() + interval '7 days')`,
    );

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@e2e.test',
        password: 'secret123',
        tenantSlug: SLUG,
      })
      .expect(200);
    token = login.body.accessToken;
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await ds.query(`DELETE FROM core."user" WHERE tenant_id = $1`, [SLUG]);
      await ds.query(`DELETE FROM core.tenant WHERE slug = $1`, [SLUG]);
    }
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // Roda o worker step direto (a app HTTP não tem consumers): atribui batch_seq
  // e aplica os itens pendentes do run no schema do tenant.
  const runWorker = async (runId: string): Promise<void> => {
    await ds.query(
      `UPDATE ${SCHEMA}.pricing_apply_item SET batch_seq = 1 WHERE apply_run_id = $1`,
      [runId],
    );
    await tx.runWithTenant(SCHEMA, (em) => step.run(em, SLUG, runId, 1));
    // Mimetiza o hook do último batch (ApplyPriceBatchConsumer.successors),
    // que aqui é pulado por chamarmos o step direto (app HTTP sem consumers).
    await ds.query(
      `UPDATE ${SCHEMA}.pricing_apply_run SET status='done' WHERE id = $1`,
      [runId],
    );
  };

  it('401 sem token', async () => {
    await request(app.getHttpServer())
      .post('/pricing/apply')
      .send({ idempotencyKey: 'x', items: [] })
      .expect(401); // guard global roda antes da validação de body
  });

  it('rejeita item abaixo do piso (custo) e aceita o válido', async () => {
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-mixed',
        items: [
          { ean: EAN_OK, target: 'precoVenda', price: 10 },
          { ean: EAN_OK, target: 'precoVenda', price: 4 }, // 4 < custo 6
        ],
      })
      .expect(202);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toEqual([
      { ean: EAN_OK, reason: 'abaixo_do_piso' },
    ]);
  });

  it('idempotência: mesmo key → mesmo run', async () => {
    const a = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-idem',
        items: [{ ean: EAN_OK, target: 'precoVenda', price: 10 }],
      })
      .expect(202);
    const b = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-idem',
        items: [{ ean: EAN_OK, target: 'precoVenda', price: 99 }],
      })
      .expect(202);
    expect(b.body.applyRunId).toBe(a.body.applyRunId);
    expect(b.body.idempotent).toBe(true);
  });

  it('aplica preço de venda no ERP e marca applied (worker)', async () => {
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-apply',
        items: [{ ean: EAN_OK, target: 'precoVenda', price: 12 }],
      })
      .expect(202);
    await runWorker(res.body.applyRunId);

    expect(a7.changePrices).toHaveBeenCalledWith(creds, [
      { idEmbalagem: 7001, precoVendaNovo: 12 },
    ]);
    const [p] = await ds.query(
      `SELECT price FROM ${SCHEMA}.product WHERE ean = ${EAN_OK}`,
    );
    expect(Number(p.price)).toBe(12);
    const report = await get(`/pricing/apply/${res.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.status).toBe('done');
    expect(report.body.applied).toBe(1);
    expect(report.body.items[0]).toMatchObject({ status: 'applied' });
  });

  it('produto monitorado → skipped (sem chamar o ERP)', async () => {
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-mon',
        items: [{ ean: EAN_MON, target: 'precoVenda', price: 10 }],
      })
      .expect(202);
    await runWorker(res.body.applyRunId);
    expect(a7.changePrices).not.toHaveBeenCalled();
    const report = await get(`/pricing/apply/${res.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.skipped).toBe(1);
    expect(report.body.items[0]).toMatchObject({
      status: 'skipped',
      reason: 'monitored',
    });
  });

  it('EAN em campanha ativa → skipped (em_campanha)', async () => {
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-camp',
        items: [{ ean: EAN_CAMP, target: 'precoVenda', price: 10 }],
      })
      .expect(202);
    await runWorker(res.body.applyRunId);
    expect(a7.changePrices).not.toHaveBeenCalled();
    const report = await get(`/pricing/apply/${res.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.skipped).toBe(1);
    expect(report.body.items[0]).toMatchObject({
      status: 'skipped',
      reason: 'em_campanha',
    });
  });
});
