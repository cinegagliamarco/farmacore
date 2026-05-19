import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBaseProductStockTable1764544317236 implements MigrationInterface {
  name = 'AddBaseProductStockTable1764544317236';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "base_product_stock" ("id" SERIAL NOT NULL, "base_product_id" integer NOT NULL, "quantity" integer NOT NULL DEFAULT '0', "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ea93f36274185b9cead9e30b9f6" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `ALTER TABLE "base_product_stock" ADD CONSTRAINT "fk_base_product_stock" FOREIGN KEY ("base_product_id") REFERENCES "base_product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product_stock" DROP CONSTRAINT "fk_base_product_stock"`);
    await queryRunner.query(`DROP TABLE "base_product_stock"`);
  }
}
