import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';

describe('Admin tenant onboarding (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);

    const hash = await argon2.hash('s3cret-sysadmin-please-rotate');
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ('system', 'sysadmin@local.test', $1, 'admin', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [hash],
    );

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'sysadmin@local.test',
        password: 's3cret-sysadmin-please-rotate',
        tenantSlug: 'system',
      })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('onboards a new tenant end-to-end', async () => {
    const slug = `e2e-${Math.random().toString(36).slice(2, 8)}`;
    const res = await request(app.getHttpServer())
      .post('/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug, name: 'E2E Tenant', adminEmail: `admin@${slug}.test` })
      .expect(201);

    expect(res.body.slug).toBe(slug);
    expect(res.body.schemaName).toBe(`tenant_${slug.replace(/-/g, '_')}`);
    expect(res.body.initialAdminUser.email).toBe(`admin@${slug}.test`);
    expect(res.body.initialAdminUser.oneTimePassword).toMatch(/^[A-Za-z0-9_-]+$/);

    const rows: Array<{ count: string }> = await ds.query(
      `SELECT count(*)::text AS count FROM ${res.body.schemaName}.tenant_competitor_origin`,
    );
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(5);
  });

  it('rejects non-system tenant tokens', async () => {
    const hash = await argon2.hash('user-password-12-chars-or-more');
    await ds.query(`
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ('acme', 'Acme', 'tenant_acme', 'active')
      ON CONFLICT (slug) DO NOTHING
    `);
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ('acme', 'u@acme.test', $1, 'admin', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [hash],
    );
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'u@acme.test',
        password: 'user-password-12-chars-or-more',
        tenantSlug: 'acme',
      })
      .expect(200);
    await request(app.getHttpServer())
      .get('/admin/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);
  });
});
