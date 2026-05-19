import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBaseProductImageTable1756258235280 implements MigrationInterface {
  public name = 'CreateBaseProductImageTable1756258235280';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_image" RENAME COLUMN "link" TO "url"`);
    await queryRunner.query(
      `CREATE TABLE "base_product_image" ("id" SERIAL NOT NULL, "base_product_id" integer NOT NULL, "url" character varying(255) NOT NULL, "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4b86415d7cb55f811fc5577eafa" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`ALTER TABLE "base_product" ADD CONSTRAINT "UQ_edee1e433e3753d743cc9cba2e1" UNIQUE ("ean")`);

    await queryRunner.query(
      `ALTER TABLE "base_product_image" ADD CONSTRAINT "fk_base_product_image" FOREIGN KEY ("base_product_id") REFERENCES "base_product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product_image" DROP CONSTRAINT "fk_base_product_image"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP CONSTRAINT "UQ_edee1e433e3753d743cc9cba2e1"`);
    await queryRunner.query(`DROP TABLE "base_product_image"`);
    await queryRunner.query(`ALTER TABLE "product_image" RENAME COLUMN "url" TO "link"`);
  }
}
