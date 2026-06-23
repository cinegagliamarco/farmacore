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
const EAN_NOCOST = '7894444444447';
const EAN_VAR = '7894444444448'; // produto dedicado (não mutado por outros testes)
const EAN_RB = '7894444444449'; // dedicado ao rollback
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
        (${EAN_OK},     'A', true, 8.00, 6.0000, '7001', false, 'OK'),
        (${EAN_MON},    'B', true, 8.00, 6.0000, '7002', true,  'OK'),
        (${EAN_CAMP},   'C', true, 8.00, 6.0000, '7003', false, 'OK'),
        (${EAN_NOCOST}, 'D', true, 8.00, NULL,   '7004', false, 'OK'),
        (${EAN_VAR},    'E', true, 8.00, 6.0000, '7005', false, 'OK'),
        (${EAN_RB},     'F', true, 20.00, 6.0000, '7006', false, 'OK')`,
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
          { ean: EAN_MON, target: 'precoVenda', price: 4 }, // 4 < custo 6
        ],
      })
      .expect(202);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toEqual([
      { ean: EAN_MON, reason: 'abaixo_do_piso' },
    ]);
  });

  it('rejeita produto sem custo (não deixa preço ~0 chegar ao ERP)', async () => {
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-nocost',
        items: [{ ean: EAN_NOCOST, target: 'precoVenda', price: 0.01 }],
      })
      .expect(202);
    expect(res.body.accepted).toBe(0);
    expect(res.body.rejected).toEqual([
      { ean: EAN_NOCOST, reason: 'sem_custo' },
    ]);
  });

  it('dedup por (ean,target): itens repetidos viram um (o último vence)', async () => {
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-dup',
        items: [
          { ean: EAN_OK, target: 'precoVenda', price: 10 },
          { ean: EAN_OK, target: 'precoVenda', price: 11 },
        ],
      })
      .expect(202);
    expect(res.body.accepted).toBe(1);
    const report = await get(`/pricing/apply/${res.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.total).toBe(1);
    expect(Number(report.body.items[0].price)).toBe(11); // último venceu
  });

  it('dispatch enfileirado SEM standalone (senão o run nunca fecha em done)', async () => {
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-nostandalone',
        items: [{ ean: EAN_OK, target: 'precoVenda', price: 12 }],
      })
      .expect(202);
    const [outbox] = await ds.query(
      `SELECT message FROM core.pipeline_outbox WHERE pipeline_run_id = $1`,
      [res.body.applyRunId],
    );
    expect(outbox.message.standalone).toBeFalsy();
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

  it('rejeita variação excessiva (>3x o preço atual)', async () => {
    // EAN_VAR venda atual = 8; preço 30 = >3x → fat-finger.
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-var',
        items: [{ ean: EAN_VAR, target: 'precoVenda', price: 30 }],
      })
      .expect(202);
    expect(res.body.accepted).toBe(0);
    expect(res.body.rejected).toEqual([
      { ean: EAN_VAR, reason: 'variacao_excessiva' },
    ]);
  });

  it('circuit breaker: lote grande majoritariamente rejeitado → 422', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      ean: `78900000000${10 + i}`, // EANs inexistentes → nao_encontrado
      target: 'precoVenda' as const,
      price: 10,
    }));
    const res = await post('/pricing/apply')
      .send({ idempotencyKey: 'k-circuit', items })
      .expect(422);
    expect(res.body.aborted).toBe(true);
    expect(res.body.rejected).toHaveLength(10);
  });

  it('grava basis na auditoria (motor)', async () => {
    const rule = await post('/pricing/suggestion-rules')
      .send({ name: 'Catch-all 40', minMargin: 40 })
      .expect(201);
    // EAN_VAR custo 6, venda 8 (margem 25% < 40%) → piso 10, basis margem_minima.
    const res = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-basis',
        items: [{ ean: EAN_VAR, target: 'precoVenda', price: 10 }],
      })
      .expect(202);
    expect(res.body.accepted).toBe(1);
    const report = await get(`/pricing/apply/${res.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.items[0].basis).toBe('margem_minima');
    expect(rule.body.id).toBeTruthy();
  });

  it('dry-run (preview): aceita/rejeita sem criar run', async () => {
    const [{ count: before }] = await ds.query(
      `SELECT count(*)::int AS count FROM ${SCHEMA}.pricing_apply_run`,
    );
    const res = await post('/pricing/apply/preview')
      .send({
        items: [
          { ean: EAN_RB, target: 'precoVenda', price: 22 },
          { ean: EAN_MON, target: 'precoVenda', price: 4 }, // < piso
        ],
      })
      .expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.accepted).toEqual([
      expect.objectContaining({ ean: EAN_RB, target: 'precoVenda', price: 22 }),
    ]);
    expect(res.body.rejected).toEqual([
      { ean: EAN_MON, reason: 'abaixo_do_piso' },
    ]);
    expect(res.body.wouldAbort).toBe(false);
    const [{ count: after }] = await ds.query(
      `SELECT count(*)::int AS count FROM ${SCHEMA}.pricing_apply_run`,
    );
    expect(after).toBe(before); // nada persistido
  });

  it('GET /pricing/apply lista os runs (mais recentes primeiro)', async () => {
    const created = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-list',
        items: [{ ean: EAN_RB, target: 'precoVenda', price: 21 }],
      })
      .expect(202);
    const list = await get('/pricing/apply').expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body[0].id).toBe(created.body.applyRunId);
    expect(list.body[0]).toHaveProperty('createdAt');
  });

  it('rollback: restaura o preço anterior do item aplicado', async () => {
    const applyRes = await post('/pricing/apply')
      .send({
        idempotencyKey: 'k-rb-apply',
        items: [{ ean: EAN_RB, target: 'precoVenda', price: 24 }],
      })
      .expect(202);
    await runWorker(applyRes.body.applyRunId);
    const [afterApply] = await ds.query(
      `SELECT price FROM ${SCHEMA}.product WHERE ean = ${EAN_RB}`,
    );
    expect(Number(afterApply.price)).toBe(24);

    const rbRes = await post(
      `/pricing/apply/${applyRes.body.applyRunId}/rollback`,
    ).expect(202);
    expect(rbRes.body.accepted).toBe(1);
    expect(rbRes.body.applyRunId).not.toBe(applyRes.body.applyRunId);
    await runWorker(rbRes.body.applyRunId);
    const [afterRb] = await ds.query(
      `SELECT price FROM ${SCHEMA}.product WHERE ean = ${EAN_RB}`,
    );
    expect(Number(afterRb.price)).toBe(20); // preço original restaurado
  });

  it('rollback de run inexistente → 404', async () => {
    await post(
      '/pricing/apply/00000000-0000-0000-0000-000000000000/rollback',
    ).expect(404);
  });
});
