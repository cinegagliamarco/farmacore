import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Regras de sugestão de preços + clusters de produto (port do pricy-shelf).
 * Tabelas no schema do tenant (resolvidas pelo search_path), junto de
 * offer_book e product. Arredondamento e origens de concorrente já vivem em
 * `core` — não são recriados aqui.
 */
export class CreatePricingSuggestionTables1700000000010
  implements MigrationInterface
{
  public name = 'CreatePricingSuggestionTables1700000000010';

  public async up(q: QueryRunner): Promise<void> {
    // product_cluster antes da regra: a FK cluster_id aponta para ele.
    await q.query(`
      CREATE TABLE product_cluster (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await q.query(`
      CREATE TABLE pricing_suggestion_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        classifications jsonb NOT NULL DEFAULT '[]'::jsonb,
        cluster_id uuid REFERENCES product_cluster(id),
        exclude_cluster_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        strategy text NOT NULL DEFAULT 'margem',
        min_margin numeric(6,2) NOT NULL,
        competitor_mode text NOT NULL DEFAULT 'weighted',
        competitors jsonb NOT NULL DEFAULT '[]'::jsonb,
        variation_pct numeric(6,2) NOT NULL DEFAULT 0,
        no_competitor_margin numeric(6,2),
        price_controlled boolean NOT NULL DEFAULT false,
        ignore_pbm boolean NOT NULL DEFAULT false,
        apply_rounding boolean NOT NULL DEFAULT true,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_psr_strategy CHECK (strategy IN ('margem','concorrencia')),
        CONSTRAINT chk_psr_competitor_mode
          CHECK (competitor_mode IN ('weighted','cascade','lowest'))
      );
      CREATE INDEX "IX_PRICING_SUGGESTION_RULE_ACTIVE"
        ON pricing_suggestion_rule(active);
    `);

    await q.query(`
      CREATE TABLE product_cluster_member (
        cluster_id uuid NOT NULL REFERENCES product_cluster(id) ON DELETE CASCADE,
        ean text NOT NULL,
        PRIMARY KEY (cluster_id, ean)
      );
      CREATE INDEX "IX_PRODUCT_CLUSTER_MEMBER_EAN" ON product_cluster_member(ean);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS product_cluster_member`);
    await q.query(`DROP TABLE IF EXISTS pricing_suggestion_rule`);
    await q.query(`DROP TABLE IF EXISTS product_cluster`);
  }
}
