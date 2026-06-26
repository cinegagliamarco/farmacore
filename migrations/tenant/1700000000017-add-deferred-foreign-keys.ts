import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FKs omitidas na init-tenant (010) por ordem de criação ou auto-ref.
 *
 * - classification.parent_id: self-ref; product.classification_id já foi
 *   adicionada no final da init, mas parent_id ficou só com índice.
 * - pricing_suggestion_rule.cluster_id: FK inline na 010 sem ON DELETE;
 *   entidade usa SET NULL ao remover cluster.
 *
 * NOT VALID + VALIDATE: adiciona a constraint sem scan bloqueante imediato,
 * depois valida — falha só se houver órfãos (rodar pre-flight em prod antes).
 */
export class AddDeferredForeignKeys1700000000017 implements MigrationInterface {
  public name = 'AddDeferredForeignKeys1700000000017';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE classification
        ADD CONSTRAINT fk_classification_parent
        FOREIGN KEY (parent_id) REFERENCES classification(id)
        ON DELETE SET NULL
        NOT VALID
    `);
    await q.query(`
      ALTER TABLE classification VALIDATE CONSTRAINT fk_classification_parent
    `);

    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        DROP CONSTRAINT IF EXISTS pricing_suggestion_rule_cluster_id_fkey
    `);
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        ADD CONSTRAINT fk_pricing_suggestion_rule_cluster
        FOREIGN KEY (cluster_id) REFERENCES product_cluster(id)
        ON DELETE SET NULL
        NOT VALID
    `);
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        VALIDATE CONSTRAINT fk_pricing_suggestion_rule_cluster
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE classification
        DROP CONSTRAINT IF EXISTS fk_classification_parent
    `);
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        DROP CONSTRAINT IF EXISTS fk_pricing_suggestion_rule_cluster
    `);
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        ADD CONSTRAINT pricing_suggestion_rule_cluster_id_fkey
        FOREIGN KEY (cluster_id) REFERENCES product_cluster(id)
    `);
  }
}
