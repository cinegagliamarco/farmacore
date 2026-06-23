import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Flags de política por regra (plano §17.5a / §17.6), default = comportamento
 * atual: `block_pbm_in_margin` bloqueia produto PBM também na estratégia margem
 * (hoje só concorrência bloqueia, ou a regra com ignore_pbm); `cascade_by_priority`
 * faz a cascata seguir a `priority` das origens (core.tenant_competitor_origin)
 * em vez da ordem do array de competitors.
 */
export class AddRulePolicyFlags1700000000014 implements MigrationInterface {
  public name = 'AddRulePolicyFlags1700000000014';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        ADD COLUMN block_pbm_in_margin boolean NOT NULL DEFAULT false,
        ADD COLUMN cascade_by_priority boolean NOT NULL DEFAULT false
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        DROP COLUMN IF EXISTS block_pbm_in_margin,
        DROP COLUMN IF EXISTS cascade_by_priority
    `);
  }
}
