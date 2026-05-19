import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNoChangesToExecutionOutcome1766152745020 implements MigrationInterface {
  public name = 'AddNoChangesToExecutionOutcome1766152745020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add NO_CHANGES to execution_outcome_enum
    await queryRunner.query(`
      ALTER TYPE "execution_outcome_enum" ADD VALUE 'NO_CHANGES'
    `);
  }

  public async down(): Promise<void> {
    // Note: PostgreSQL doesn't support removing enum values directly
    // You would need to recreate the enum type if you want to remove a value
    // For now, we'll leave this as a no-op since removing enum values is complex
    // and rarely needed in production
  }
}
