import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkipImageGenerationToBaseProduct1766152745035 implements MigrationInterface {
  public name = 'AddSkipImageGenerationToBaseProduct1766152745035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "base_product" ADD COLUMN "skip_image_generation" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "skip_image_generation"`);
  }
}
