import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';

describe('Admin competitor origins (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let slug: string;

  const base = () => `/admin/tenants/${slug}/competitor-origins`;
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

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

    slug = `e2e-co-${Math.random().toString(36).slice(2, 8)}`;
    await auth(
      request(app.getHttpServer())
        .post('/admin/tenants')
        .send({ slug, name: 'CO Tenant', adminEmail: `admin@${slug}.test` }),
    ).expect(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('lists seeded origins disabled, with the panel shape and no config', async () => {
    const res = await auth(request(app.getHttpServer()).get(base())).expect(
      200,
    );

    expect(res.body.length).toBeGreaterThanOrEqual(5);
    for (const row of res.body) {
      expect(Object.keys(row).sort()).toEqual([
        'enabled',
        'label',
        'origin',
        'priority',
      ]);
      expect(row).not.toHaveProperty('config');
      expect(typeof row.label).toBe('string');
      expect(typeof row.priority).toBe('number');
      expect(row.enabled).toBe(false);
    }
  });

  it('reflects bulkUpdate and orders by priority ASC, origin ASC', async () => {
    await auth(
      request(app.getHttpServer())
        .put(base())
        .send({
          origins: [
            { origin: 'DROGAL', enabled: true, priority: 10 },
            { origin: 'DROGASIL', enabled: true, priority: 5 },
          ],
        }),
    ).expect(200);

    const res = await auth(request(app.getHttpServer()).get(base())).expect(
      200,
    );

    expect(res.body[0]).toMatchObject({
      origin: 'DROGASIL',
      enabled: true,
      priority: 5,
    });
    expect(res.body[1]).toMatchObject({
      origin: 'DROGAL',
      enabled: true,
      priority: 10,
    });
    // The untouched origins keep priority 100 and trail in alphabetical order.
    expect(res.body[2].priority).toBe(100);
  });

  it('excludes soft-deleted rows', async () => {
    await ds.query(
      `UPDATE core.tenant_competitor_origin tco
          SET deleted_at = now()
         FROM core.tenant t
        WHERE t.id = tco.tenant_id AND t.slug = $1 AND tco.origin = 'IKESAKI'`,
      [slug],
    );

    const res = await auth(request(app.getHttpServer()).get(base())).expect(
      200,
    );

    expect(res.body.map((r: { origin: string }) => r.origin)).not.toContain(
      'IKESAKI',
    );
  });

  it('returns 404 for an unknown tenant', async () => {
    await auth(
      request(app.getHttpServer()).get(
        `/admin/tenants/does-not-exist-${Math.random().toString(36).slice(2, 8)}/competitor-origins`,
      ),
    ).expect(404);
  });
});
