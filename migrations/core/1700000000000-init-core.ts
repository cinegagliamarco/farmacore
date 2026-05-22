import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitCore1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS core`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    await queryRunner.query(`
      CREATE TABLE core.tenant (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        slug text NOT NULL,
        name text NOT NULL,
        schema_name text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_tenant_status CHECK (status IN ('active','paused','suspended'))
      );
      CREATE UNIQUE INDEX "UQ_TENANT_SLUG" ON core.tenant(slug);
      CREATE UNIQUE INDEX "UQ_TENANT_SCHEMA_NAME" ON core.tenant(schema_name);
    `);

    await queryRunner.query(`
      CREATE TABLE core.integration_database_connection (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        name text NOT NULL,
        type text NOT NULL DEFAULT 'postgres',
        host text NOT NULL,
        port int NOT NULL,
        database text NOT NULL,
        username text NOT NULL,
        password_encrypted bytea NOT NULL,
        ssl_mode text NOT NULL DEFAULT 'require',
        ssl_ca_cert text,
        read_only boolean NOT NULL DEFAULT true,
        connection_options jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'active',
        last_verified_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_INTEGRATION_DB_TENANT" ON core.integration_database_connection(tenant_id);
    `);

    await queryRunner.query(`
      CREATE TABLE core."user" (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id text NOT NULL,
        email citext NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'viewer',
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_user_role CHECK (role IN ('admin','operator','viewer')),
        CONSTRAINT chk_user_status CHECK (status IN ('active','disabled'))
      );
      CREATE UNIQUE INDEX "UQ_USER_TENANT_EMAIL" ON core."user"(tenant_id, email);
    `);

    await queryRunner.query(`
      CREATE TABLE core.refresh_token (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL REFERENCES core."user"(id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_REFRESH_TOKEN_USER" ON core.refresh_token(user_id);
    `);

    await queryRunner.query(`
      CREATE TABLE core.pipeline_run (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        pipeline_run_id uuid NOT NULL,
        tenant_id text NOT NULL,
        step text NOT NULL,
        status text NOT NULL,
        attempt int NOT NULL DEFAULT 1,
        started_at timestamptz NOT NULL,
        finished_at timestamptz,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_pipeline_run_status CHECK (status IN ('running','completed','failed'))
      );
      CREATE INDEX "IX_PIPELINE_RUN_TENANT_STEP_STARTED" ON core.pipeline_run(tenant_id, step, started_at);
      CREATE UNIQUE INDEX "UQ_PIPELINE_RUN_RUN_STEP" ON core.pipeline_run(pipeline_run_id, step);
    `);

    await queryRunner.query(`
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ('system', 'System', 'system', 'active')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS core CASCADE`);
  }
}
