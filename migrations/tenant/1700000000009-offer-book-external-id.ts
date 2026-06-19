import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Offer write-back: A7Pharma's /webapi/api/oferta/ keys offers by
 * idCadernoOferta (the caderno de ofertas). Store it per offer so
 * POST/DELETE /products/:ean/offer can push to the right caderno.
 */
export class OfferBookExternalId1700000000009 implements MigrationInterface {
  public name = 'OfferBookExternalId1700000000009';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE offer_book ADD COLUMN external_id bigint`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE offer_book DROP COLUMN external_id`);
  }
}
