import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStrictCompetitorPriceToEnum1766152745016 implements MigrationInterface {
  public name = 'AddStrictCompetitorPriceToEnum1766152745016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "calculation_base_type_enum" ADD VALUE 'STRICT_COMPETITOR_PRICE'
    `);
  }

  public async down(): Promise<void> {
    // Note: PostgreSQL does not support removing enum values directly.
    // If you need to rollback, you would need to:
    // 1. Create a new enum without the value
    // 2. Alter the column to use the new enum
    // 3. Drop the old enum
    // This is complex and risky, so we're leaving this empty.
    // If needed, create a separate migration to handle the rollback.
    throw new Error('Cannot remove enum value. This migration cannot be rolled back safely.');
  }
}
