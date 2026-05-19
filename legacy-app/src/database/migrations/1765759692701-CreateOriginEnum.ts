import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOriginEnum1765759692701 implements MigrationInterface {
  public name = 'CreateOriginEnum1765759692701';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."origin_enum" AS ENUM(
        'DROGAL',
        'DROGASIL',
        'PAGUE_MENOS',
        'IKESAKI',
        'MICHELASSI'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TYPE "public"."origin_enum"`);
  }
}
