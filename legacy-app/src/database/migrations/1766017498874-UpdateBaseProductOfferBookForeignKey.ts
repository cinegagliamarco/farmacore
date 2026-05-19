import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateBaseProductOfferBookForeignKey1766017498874 implements MigrationInterface {
  name = 'UpdateBaseProductOfferBookForeignKey1766017498874';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book" DROP CONSTRAINT "fk_offer_book_base_product"`);
    await queryRunner.query(
      `ALTER TABLE "offer_book" ADD CONSTRAINT "fk_offer_book_base_product" FOREIGN KEY ("base_product_id") REFERENCES "base_product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book" DROP CONSTRAINT "fk_offer_book_base_product"`);
    await queryRunner.query(
      `ALTER TABLE "offer_book" ADD CONSTRAINT "fk_offer_book_base_product" FOREIGN KEY ("base_product_id") REFERENCES "base_product"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }
}
