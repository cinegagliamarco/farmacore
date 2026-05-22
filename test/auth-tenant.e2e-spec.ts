import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';

describe('Auth + tenant isolation (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;

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

    await ds.query(`
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ('acme', 'Acme', 'tenant_acme', 'active')
      ON CONFLICT (slug) DO NOTHING
    `);
    const hash = await argon2.hash('correctpassword');
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ('acme', 'user@acme.test', $1, 'admin', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [hash],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects /auth/me without token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('logs in and returns a token usable on /auth/me', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user@acme.test',
        password: 'correctpassword',
        tenantSlug: 'acme',
      })
      .expect(200);
    expect(login.body.accessToken).toBeDefined();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.tenantId).toBe('acme');
    expect(me.body.role).toBe('admin');
  });

  it('rejects login with wrong tenant', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user@acme.test',
        password: 'correctpassword',
        tenantSlug: 'other',
      })
      .expect(401);
  });
});
