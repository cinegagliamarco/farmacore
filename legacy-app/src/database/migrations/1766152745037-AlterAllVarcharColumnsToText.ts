import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterAllVarcharColumnsToText1766152745037 implements MigrationInterface {
  public name = 'AlterAllVarcharColumnsToText1766152745037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "active_ingredient" ALTER COLUMN "name" TYPE text`);

    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "name" TYPE text`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "book" TYPE text`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "curve" TYPE text`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "supplier" TYPE text`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "status" TYPE text`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "active_ingredient" TYPE text`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "receipt_date" TYPE text`);

    await queryRunner.query(`ALTER TABLE "base_product_image" ALTER COLUMN "url" TYPE text`);

    await queryRunner.query(`ALTER TABLE "classification" ALTER COLUMN "name" TYPE text`);

    await queryRunner.query(`ALTER TABLE "offer_book" ALTER COLUMN "name" TYPE text`);

    await queryRunner.query(`ALTER TABLE "offer_book_info" ALTER COLUMN "name" TYPE text`);

    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report_item" ALTER COLUMN "name" TYPE text`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report_item" ALTER COLUMN "classification" TYPE text`);

    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "name" TYPE text`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "brand" TYPE text`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "image" TYPE text`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "supplier" TYPE text`);

    await queryRunner.query(`ALTER TABLE "product_image" ALTER COLUMN "url" TYPE text`);

    await queryRunner.query(`ALTER TABLE "scheduling" ALTER COLUMN "value" TYPE text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "active_ingredient" ALTER COLUMN "name" TYPE character varying(255)`);

    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "name" TYPE character varying(255)`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "book" TYPE character varying(255)`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "curve" TYPE character varying(1)`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "supplier" TYPE character varying(255)`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "status" TYPE character varying(20)`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "active_ingredient" TYPE character varying(255)`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "receipt_date" TYPE character varying(10)`);

    await queryRunner.query(`ALTER TABLE "base_product_image" ALTER COLUMN "url" TYPE character varying(255)`);

    await queryRunner.query(`ALTER TABLE "classification" ALTER COLUMN "name" TYPE character varying(500)`);

    await queryRunner.query(`ALTER TABLE "offer_book" ALTER COLUMN "name" TYPE character varying(255)`);

    await queryRunner.query(`ALTER TABLE "offer_book_info" ALTER COLUMN "name" TYPE character varying(255)`);

    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report_item" ALTER COLUMN "name" TYPE character varying(500)`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report_item" ALTER COLUMN "classification" TYPE character varying(500)`);

    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "name" TYPE character varying(255)`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "brand" TYPE character varying(255)`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "image" TYPE character varying(255)`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "supplier" TYPE character varying(255)`);

    await queryRunner.query(`ALTER TABLE "product_image" ALTER COLUMN "url" TYPE character varying(255)`);

    await queryRunner.query(`ALTER TABLE "scheduling" ALTER COLUMN "value" TYPE character varying(255)`);
  }
}
