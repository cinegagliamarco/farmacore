import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * E2E do port de Regras de Sugestão + Sugestão de Preços. Boota o AppModule
 * real contra o DB local (core + shared_catalog migrados), provisiona um tenant
 * próprio (schema criado/migrado/dropado por run) e exercita: CRUD das regras
 * com validação, CRUD de cluster com bloqueio de delete em uso, e o motor de
 * sugestão (estratégias margem e concorrência) sobre o join direto no banco.
 * Requer o stack docker (postgres :5433, rabbitmq :5673) com NODE_ENV=development.
 */
const SLUG = 'e2epricing';
const SCHEMA = 'tenant_e2epricing';
const ROOT_ID = '33333333-3333-3333-3333-333333333333';
const EAN = '7893333333333';

describe('Pricing suggestions (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;
  let tenantId: string;

  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const post = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
  const del = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${token}`);

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
    const tenantRows: Array<{ id: string }> = await ds.query(
      `SELECT id FROM core.tenant WHERE slug = $1`,
      [SLUG],
    );
    tenantId = tenantRows[0].id;
    const hash = await argon2.hash('secret123');
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ($1, 'admin@e2e.test', $2, 'admin', 'active'),
              ($1, 'op@e2e.test', $2, 'operator', 'active'),
              ($1, 'viewer@e2e.test', $2, 'viewer', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [SLUG, hash],
    );

    execSync(`npm run migration:tenant ${SLUG}`, { stdio: 'inherit' });

    await ds.query(
      `INSERT INTO ${SCHEMA}.classification (id, name, parent_id, visible)
       VALUES ($1, 'Genéricos', NULL, true)`,
      [ROOT_ID],
    );
    // custo 6, P. Venda 8 → margem 25%. Catch-all margem 40% sugere 6/0.6 = 10.
    await ds.query(
      `INSERT INTO ${SCHEMA}.product
         (ean, name, active, price, cost, classification_id, external_id, generic, status)
       VALUES (${EAN}, 'Dipirona 500mg', true, 8.00, 6.0000, $1, '6001', true, 'OK')`,
      [ROOT_ID],
    );
    // Concorrente DROGAL a 12 (sem PBM) + origem habilitada (core, por tenant_id).
    await ds.query(`DELETE FROM shared_catalog.product WHERE ean = ${EAN}`);
    await ds.query(
      `INSERT INTO shared_catalog.product (ean, origin, name, price, metadata)
       VALUES (${EAN}, 'DROGAL', 'Dipirona', 12.00, '{}'::jsonb)`,
    );
    await ds.query(
      `INSERT INTO core.tenant_competitor_origin (tenant_id, origin, enabled)
       VALUES ($1, 'DROGAL', true)
       ON CONFLICT (tenant_id, origin) DO UPDATE SET enabled = true`,
      [tenantId],
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
    viewerToken = await login('viewer@e2e.test');
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await ds.query(`DELETE FROM shared_catalog.product WHERE ean = ${EAN}`);
      const rows: Array<{ id: string }> = await ds.query(
        `SELECT id FROM core.tenant WHERE slug = $1`,
        [SLUG],
      );
      const id = rows[0]?.id;
      if (id)
        await ds.query(
          `DELETE FROM core.tenant_competitor_origin WHERE tenant_id = $1`,
          [id],
        );
      await ds.query(`DELETE FROM core."user" WHERE tenant_id = $1`, [SLUG]);
      await ds.query(`DELETE FROM core.tenant WHERE slug = $1`, [SLUG]);
    }
    await app?.close();
  });

  // Cada teste limpa as regras que cria; a sugestão computa sobre as regras ativas.
  afterEach(async () => {
    await ds.query(`DELETE FROM ${SCHEMA}.pricing_suggestion_rule`);
    await ds.query(`DELETE FROM ${SCHEMA}.product_cluster`);
  });

  describe('auth + validação', () => {
    it('401 sem token', async () => {
      await request(app.getHttpServer())
        .get('/pricing/suggestion-rules')
        .expect(401);
    });

    it('400 quando mira classificação E cluster', async () => {
      await post('/pricing/suggestion-rules')
        .send({
          name: 'inválida',
          minMargin: 30,
          classifications: ['GENÉRICOS'],
          clusterId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
    });

    it('400 concorrência sem concorrentes', async () => {
      await post('/pricing/suggestion-rules')
        .send({ name: 'sem conc', minMargin: 10, strategy: 'concorrencia' })
        .expect(400);
    });

    it('400 concorrente duplicado (§17.4)', async () => {
      await post('/pricing/suggestion-rules')
        .send({
          name: 'dup',
          minMargin: 10,
          strategy: 'concorrencia',
          competitorMode: 'cascade',
          competitors: [{ competitor: 'DROGAL' }, { competitor: 'DROGAL' }],
        })
        .expect(400);
    });

    it('400 concorrente não habilitado no tenant (§17.11)', async () => {
      // só DROGAL está habilitado para o e2epricing; DROGASIL não.
      await post('/pricing/suggestion-rules')
        .send({
          name: 'origem fora',
          minMargin: 10,
          strategy: 'concorrencia',
          competitorMode: 'lowest',
          competitors: [{ competitor: 'DROGASIL' }],
        })
        .expect(400);
      // o preview (dry-run) aplica a mesma trava
      await post('/pricing/suggestions/preview')
        .send({
          name: 'preview fora',
          minMargin: 10,
          strategy: 'concorrencia',
          competitorMode: 'lowest',
          competitors: [{ competitor: 'DROGASIL' }],
        })
        .expect(400);
    });

    it('persiste flags de política (blockPbmInMargin, cascadeByPriority)', async () => {
      const r = await post('/pricing/suggestion-rules')
        .send({
          name: 'flags',
          minMargin: 30,
          blockPbmInMargin: true,
          cascadeByPriority: true,
        })
        .expect(201);
      expect(r.body).toMatchObject({
        blockPbmInMargin: true,
        cascadeByPriority: true,
      });
    });

    it('400 clusterId malformado (não-UUID)', async () => {
      await post('/pricing/suggestion-rules')
        .send({ name: 'uuid ruim', minMargin: 10, clusterId: 'nao-é-uuid' })
        .expect(400);
    });

    it('400 cluster inexistente (FK 23503 → 400 claro)', async () => {
      await post('/pricing/suggestion-rules')
        .send({
          name: 'cluster fantasma',
          minMargin: 10,
          clusterId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
    });
  });

  describe('GET /pricing/competitor-origins (§17.11)', () => {
    it('lista só as origens do tenant; viewer 403', async () => {
      const res = await get('/pricing/competitor-origins').expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({ origin: 'DROGAL', enabled: true }),
      ]);
      await get('/pricing/competitor-origins', viewerToken).expect(403);
    });
  });

  describe('CRUD de regras', () => {
    it('cria, lista e remove', async () => {
      const created = await post('/pricing/suggestion-rules')
        .send({ name: 'Piso 30', minMargin: 30 })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'Piso 30',
        minMargin: 30,
        strategy: 'margem',
        applyRounding: true,
        active: true,
      });
      const list = await get('/pricing/suggestion-rules').expect(200);
      expect(list.body).toHaveLength(1);
      await del(`/pricing/suggestion-rules/${created.body.id}`).expect(200);
      const after = await get('/pricing/suggestion-rules').expect(200);
      expect(after.body).toHaveLength(0);
    });

    it('operator pode criar; viewer-less 401', async () => {
      await post('/pricing/suggestion-rules', operatorToken)
        .send({ name: 'op rule', minMargin: 20 })
        .expect(201);
    });

    it('viewer não lê regras nem clusters (403)', async () => {
      await get('/pricing/suggestion-rules', viewerToken).expect(403);
      await get('/pricing/clusters', viewerToken).expect(403);
    });
  });

  describe('trilha de auditoria (§17.10)', () => {
    it('registra create/update/delete da regra e expõe em GET /pricing/audit (admin)', async () => {
      const created = await post('/pricing/suggestion-rules')
        .send({ name: 'auditada', minMargin: 25 })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/pricing/suggestion-rules/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'auditada-v2', minMargin: 26 })
        .expect(200);
      await del(`/pricing/suggestion-rules/${created.body.id}`).expect(200);

      const audit = await get(
        `/pricing/audit?entity=suggestion_rule&entityId=${created.body.id}`,
      ).expect(200);
      const actions = (audit.body as Array<{ action: string }>).map(
        (e) => e.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['create', 'update', 'delete']),
      );
    });

    it('operator não acessa a trilha (admin-only, 403)', async () => {
      await get('/pricing/audit', operatorToken).expect(403);
    });
  });

  describe('cluster — bloqueio de delete em uso', () => {
    it('409 ao apagar cluster referenciado por uma regra', async () => {
      const cluster = await post('/pricing/clusters')
        .send({ name: 'Cluster A', eans: [EAN] })
        .expect(201);
      expect(cluster.body.memberCount).toBe(1);
      await post('/pricing/suggestion-rules')
        .send({
          name: 'mira cluster',
          minMargin: 10,
          clusterId: cluster.body.id,
        })
        .expect(201);
      await del(`/pricing/clusters/${cluster.body.id}`).expect(409);
    });

    it('apaga um cluster não referenciado', async () => {
      const cluster = await post('/pricing/clusters')
        .send({ name: 'Cluster B', eans: [EAN] })
        .expect(201);
      await del(`/pricing/clusters/${cluster.body.id}`)
        .expect(200)
        .expect((r) =>
          expect(r.body).toEqual({ id: cluster.body.id, name: 'Cluster B' }),
        );
      const list = await get('/pricing/clusters').expect(200);
      expect(
        list.body.some((c: { id: string }) => c.id === cluster.body.id),
      ).toBe(false);
    });
  });

  describe('GET /pricing/suggestions — motor', () => {
    it('estratégia margem: sugere custo/(1-margem)', async () => {
      await post('/pricing/suggestion-rules')
        .send({ name: 'Margem 40', minMargin: 40 })
        .expect(201);
      const res = await get('/pricing/suggestions').expect(200);
      expect(res.body.activeRuleCount).toBe(1);
      const row = res.body.rows.find(
        (r: { product: { ean: string } }) => r.product.ean === EAN,
      );
      expect(row.result.kind).toBe('suggestion');
      expect(row.result.suggestion.price).toBeCloseTo(10, 2); // 6 / 0.6
      expect(row.result.suggestion.basis).toBe('margem_minima');
      // o produto carrega o preço do concorrente habilitado (DROGAL 12)
      expect(row.product.competitors).toEqual([
        { origin: 'DROGAL', price: 12, isPbm: false, van: null },
      ]);
    });

    it('estratégia concorrência: segue o preço do concorrente', async () => {
      await post('/pricing/suggestion-rules')
        .send({
          name: 'Seguir DROGAL',
          minMargin: 10,
          strategy: 'concorrencia',
          competitorMode: 'lowest',
          competitors: [{ competitor: 'DROGAL' }],
        })
        .expect(201);
      const res = await get(
        '/pricing/suggestions?onlyWithSuggestion=true',
      ).expect(200);
      const row = res.body.rows.find(
        (r: { product: { ean: string } }) => r.product.ean === EAN,
      );
      expect(row.result.kind).toBe('suggestion');
      expect(row.result.suggestion.basis).toBe('concorrencia');
      expect(row.result.suggestion.price).toBeCloseTo(12, 2); // segue DROGAL
    });
  });

  describe('POST /pricing/suggestions/preview — dry-run de regra', () => {
    it('calcula com a regra transitória e não a persiste', async () => {
      const before = (await get('/pricing/suggestion-rules').expect(200)).body
        .length;
      const res = await post('/pricing/suggestions/preview')
        .send({ name: 'Preview 50', minMargin: 50 })
        .expect(200);
      expect(res.body.activeRuleCount).toBe(1); // só a transitória
      const row = res.body.rows.find(
        (r: { product: { ean: string } }) => r.product.ean === EAN,
      );
      expect(row.result.kind).toBe('suggestion');
      expect(row.result.suggestion.price).toBeCloseTo(12, 2); // 6 / 0.5
      const after = (await get('/pricing/suggestion-rules').expect(200)).body
        .length;
      expect(after).toBe(before); // nada salvo
    });

    it('valida a regra do preview (concorrência sem concorrentes → 400)', async () => {
      await post('/pricing/suggestions/preview')
        .send({ name: 'ruim', minMargin: 10, strategy: 'concorrencia' })
        .expect(400);
    });
  });
});
