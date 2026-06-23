import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invariante classificação-XOR-cluster no DB (cinto-e-suspensório do check de
 * borda em suggestion-rules.service): uma regra mira classificação OU cluster,
 * nunca os dois. `cluster_id` setado ⇒ `classifications` vazio. A tabela
 * pricing_suggestion_rule veio na migration 010 (sem o CHECK); adiciona aqui.
 */
export class AddRuleClassClusterCheck1700000000013
  implements MigrationInterface
{
  public name = 'AddRuleClassClusterCheck1700000000013';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        ADD CONSTRAINT chk_psr_class_xor_cluster
        CHECK (cluster_id IS NULL OR classifications = '[]'::jsonb)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        DROP CONSTRAINT IF EXISTS chk_psr_class_xor_cluster
    `);
  }
}
