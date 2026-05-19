import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductStockTable1761671135679 implements MigrationInterface {
    name = 'AddProductStockTable1761671135679'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "product_stock" (
                "id" SERIAL NOT NULL,
                "product_id" integer NOT NULL,
                "subsidiary_one_stock" integer NOT NULL DEFAULT '0',
                "subsidiary_two_stock" integer NOT NULL DEFAULT '0',
                "has_stock" boolean NOT NULL DEFAULT false,
                "error" text,
                "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_62a8438c36b1a42790d3cd755a1" UNIQUE ("product_id"),
                CONSTRAINT "REL_62a8438c36b1a42790d3cd755a" UNIQUE ("product_id"),
                CONSTRAINT "PK_557112c9955555e7d08fa913f3f" PRIMARY KEY ("id")
            )
        `);
        
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "subsidiary_one_stock"`);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "subsidiary_two_stock"`);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "has_stock"`);
        
        await queryRunner.query(`
            ALTER TABLE "product_stock" 
            ADD CONSTRAINT "fk_product_stock" 
            FOREIGN KEY ("product_id") 
            REFERENCES "product"("id") 
            ON DELETE CASCADE 
            ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product_stock" DROP CONSTRAINT "fk_product_stock"`);
        
        await queryRunner.query(`ALTER TABLE "product" ADD "subsidiary_one_stock" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "product" ADD "subsidiary_two_stock" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "product" ADD "has_stock" boolean NOT NULL DEFAULT false`);
        
        await queryRunner.query(`DROP TABLE "product_stock"`);
    }

}
