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
import { PricingScheduleCron } from '../src/tenant-api/pricing/pricing-schedule.cron';

/**
 * E2E do agendamento one-shot (Fase 3.2): cria, lista, cancela e DISPARA. O
 * disparo (cron) reusa o apply em massa com os preços congelados — testado
 * chamando o cron direto contra o DB real (A7 mockado).
 */
const SLUG = 'e2esched';
const SCHEMA = 'tenant_e2esched';
const EAN = '7895555555555';
const EAN_OFF = '7895555555556'; // tem oferta → motor escolhe target precoOferta
const a7 = { changePrices: jest.fn(), upsertOffer: jest.fn() };
const creds = { baseUrl: 'https://erp.test', apiKey: 'key' };

describe('Pricing schedule (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let cron: PricingScheduleCron;

  const post = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const del = (path: string) =>
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
      .useValue({ getApiCredentials: jest.fn().mockResolvedValue(creds) })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);
    cron = app.get(PricingScheduleCron);

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
    await ds.query(
      `INSERT INTO ${SCHEMA}.product
         (ean, name, active, price, cost, external_id, monitored, status) VALUES
        (${EAN},     'A', true, 8.00,  6.0000, '8001', false, 'OK'),
        (${EAN_OFF}, 'B', true, 20.00, 6.0000, '8002', false, 'OK')`,
    );
    // EAN_OFF tem caderno de oferta ABAIXO do piso (8 < 6/0.5=12) → motor sugere
    // SUBIR a oferta para 12, no precoOferta (não no venda que o item pediu).
    await ds.query(
      `INSERT INTO ${SCHEMA}.offer_book (ean, description, target_price, external_id)
       VALUES (${EAN_OFF}, 'promo', 8.00, 8200)`,
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

  it('cria, lista e cancela um agendamento', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const created = await post('/pricing/schedules')
      .send({
        runAt: future,
        items: [{ ean: EAN, target: 'precoVenda', price: 10 }],
      })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'pending', itemCount: 1 });

    const list = await get('/pricing/schedules').expect(200);
    expect(
      list.body.some((s: { id: string }) => s.id === created.body.id),
    ).toBe(true);

    await del(`/pricing/schedules/${created.body.id}`)
      .expect(200)
      .expect((r) => expect(r.body.cancelled).toBe(true));
    const after = await get(`/pricing/schedules/${created.body.id}`).expect(
      200,
    );
    expect(after.body.status).toBe('cancelled');
  });

  it('cron dispara o agendamento vencido → cria apply run e marca fired', async () => {
    const created = await post('/pricing/schedules')
      .send({
        runAt: new Date(Date.now() + 3600_000).toISOString(),
        items: [{ ean: EAN, target: 'precoVenda', price: 12 }],
      })
      .expect(201);
    // Vence o agendamento (run_at no passado) e dispara o cron determinístico.
    await ds.query(
      `UPDATE ${SCHEMA}.pricing_schedule SET run_at = now() - interval '1 minute' WHERE id = $1`,
      [created.body.id],
    );
    await cron.fire();

    const sched = await get(`/pricing/schedules/${created.body.id}`).expect(
      200,
    );
    expect(sched.body.status).toBe('fired');
    expect(sched.body.applyRunId).toBeTruthy();

    // O disparo criou um apply run com o item congelado (pendente de push).
    const report = await get(`/pricing/apply/${sched.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.total).toBe(1);
    expect(report.body.items[0]).toMatchObject({ ean: EAN, status: 'pending' });

    // Cancelar um já disparado é 409 (cancel atômico não sobrescreve 'fired').
    await del(`/pricing/schedules/${created.body.id}`).expect(409);
  });

  it('cronExpr inválido → 400', async () => {
    await post('/pricing/schedules')
      .send({
        runAt: new Date(Date.now() + 3600_000).toISOString(),
        items: [{ ean: EAN, target: 'precoVenda', price: 10 }],
        cronExpr: 'isto não é cron',
      })
      .expect(400);
  });

  it('recorrência: cronExpr re-arma para a próxima ocorrência (não fica fired)', async () => {
    const created = await post('/pricing/schedules')
      .send({
        runAt: new Date(Date.now() + 3600_000).toISOString(),
        items: [{ ean: EAN, target: 'precoVenda', price: 12 }],
        cronExpr: '0 0 * * *', // diário à meia-noite
      })
      .expect(201);
    expect(created.body.cronExpr).toBe('0 0 * * *');
    expect(created.body.recalc).toBe(false);

    await ds.query(
      `UPDATE ${SCHEMA}.pricing_schedule SET run_at = now() - interval '1 minute' WHERE id = $1`,
      [created.body.id],
    );
    await cron.fire();

    const sched = await get(`/pricing/schedules/${created.body.id}`).expect(
      200,
    );
    expect(sched.body.status).toBe('pending'); // re-armado, não 'fired'
    expect(sched.body.applyRunId).toBeTruthy(); // último disparo registrado
    expect(new Date(sched.body.runAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('recalc: recalcula o preço pelo motor no disparo (ignora o congelado)', async () => {
    // margem 50 → motor sugere custo/(1-0.5) = 6/0.5 = 12 para o EAN.
    await post('/pricing/suggestion-rules')
      .send({ name: 'Margem 50', minMargin: 50 })
      .expect(201);
    const created = await post('/pricing/schedules')
      .send({
        runAt: new Date(Date.now() + 3600_000).toISOString(),
        items: [{ ean: EAN, target: 'precoVenda', price: 99 }], // congelado absurdo
        recalc: true,
      })
      .expect(201);
    expect(created.body.recalc).toBe(true);

    await ds.query(
      `UPDATE ${SCHEMA}.pricing_schedule SET run_at = now() - interval '1 minute' WHERE id = $1`,
      [created.body.id],
    );
    await cron.fire();

    const sched = await get(`/pricing/schedules/${created.body.id}`).expect(
      200,
    );
    expect(sched.body.status).toBe('fired'); // one-shot
    const report = await get(`/pricing/apply/${sched.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.total).toBe(1);
    expect(Number(report.body.items[0].price)).toBe(12); // recalculado, não 99
  });

  it('recalc usa o ALVO do motor, não o do item agendado', async () => {
    // Reusa a regra "Margem 50" do teste anterior. EAN_OFF tem caderno → o motor
    // sugere no precoOferta (6/0.5 = 12 ≤ venda 20), mesmo o item pedindo venda.
    const created = await post('/pricing/schedules')
      .send({
        runAt: new Date(Date.now() + 3600_000).toISOString(),
        items: [{ ean: EAN_OFF, target: 'precoVenda', price: 99 }],
        recalc: true,
      })
      .expect(201);
    await ds.query(
      `UPDATE ${SCHEMA}.pricing_schedule SET run_at = now() - interval '1 minute' WHERE id = $1`,
      [created.body.id],
    );
    await cron.fire();

    const sched = await get(`/pricing/schedules/${created.body.id}`).expect(
      200,
    );
    const report = await get(`/pricing/apply/${sched.body.applyRunId}`).expect(
      200,
    );
    expect(report.body.items[0]).toMatchObject({ target: 'precoOferta' });
    expect(Number(report.body.items[0].price)).toBe(12);
  });
});
