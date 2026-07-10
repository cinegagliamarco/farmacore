import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Precificação por loja no fluxo de sugestão:
 * - regra declara as lojas participantes (`store_ids`, vazio = todas ativas);
 * - product_item ganha o caderno de oferta vencedor da loja (id externo +
 *   nome), preenchido pelo sync via unidadenegocioparticipantecadernooferta;
 * - item de apply carrega a loja alvo (NULL = aplicação global legada);
 * - `price_offer` muda de semântica (era espelho do offer_book global; vira a
 *   oferta REAL da loja) — os valores legados são anulados de uma vez, como a
 *   1700000000021 fez com os snapshots de price/cost, senão as leituras por
 *   loja serviriam o espelho antigo como se fosse a oferta da loja.
 *
 * ROLLOUT: rodar `npm run migration:tenant:all` LOGO APÓS o deploy (as
 * migrations de tenant aplicam um deploy atrasadas) — até aplicar, o SELECT
 * de store_ids derruba o módulo de pricing inteiro do tenant; e disparar um
 * sync-product-items para repovoar as ofertas por loja (até lá, as leituras
 * por loja mostram "sem oferta").
 */
export class PricingPerStore1700000000024 implements MigrationInterface {
  public name = 'PricingPerStore1700000000024';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_suggestion_rule
        ADD COLUMN store_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE product_item
        ADD COLUMN offer_external_id bigint,
        ADD COLUMN offer_description text;
      ALTER TABLE pricing_apply_item
        ADD COLUMN store_id uuid;
      UPDATE product_item SET price_offer = NULL WHERE price_offer IS NOT NULL;
    `);
  }

  // Reverter NÃO restaura os espelhos globais de price_offer (o sync noturno
  // repõe) e descarta o escopo de loja: uma regra restrita a uma loja volta a
  // valer para a rede inteira sob o código antigo, e o histórico de apply
  // perde a atribuição de loja (um rollback de run por loja viraria global).
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_apply_item DROP COLUMN store_id;
      ALTER TABLE product_item
        DROP COLUMN offer_external_id,
        DROP COLUMN offer_description;
      ALTER TABLE pricing_suggestion_rule DROP COLUMN store_ids;
    `);
  }
}
