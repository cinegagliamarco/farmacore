import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trilha de auditoria do tenant (§17.10): quem fez o quê em regras, clusters,
 * apply e agendamentos. Append-only; `changes` guarda o payload/resultado.
 */
export class CreateAuditLog1700000000015 implements MigrationInterface {
  public name = 'CreateAuditLog1700000000015';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        actor uuid,
        action text NOT NULL,
        entity text NOT NULL,
        entity_id text,
        changes jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IX_AUDIT_LOG_ENTITY" ON audit_log(entity, entity_id);
      CREATE INDEX "IX_AUDIT_LOG_CREATED" ON audit_log(created_at DESC);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_log`);
  }
}
