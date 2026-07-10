import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The schedule cron now parks a schedule whose apply threw as 'failed'
 * (instead of retrying the whole batch forever), but chk_psch_status
 * from 1700000000012 only allows pending/fired/cancelled — the parking
 * UPDATE would violate it and re-create the poison-schedule loop.
 */
export class AddFailedPricingScheduleStatus1700000000023
  implements MigrationInterface
{
  public name = 'AddFailedPricingScheduleStatus1700000000023';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_schedule
        DROP CONSTRAINT chk_psch_status,
        ADD CONSTRAINT chk_psch_status
          CHECK (status IN ('pending','fired','cancelled','failed'))
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Re-adding the narrow CHECK validates existing rows — remap any 'failed'
    // first or the ALTER itself fails.
    await q.query(
      `UPDATE pricing_schedule SET status = 'cancelled' WHERE status = 'failed'`,
    );
    await q.query(`
      ALTER TABLE pricing_schedule
        DROP CONSTRAINT chk_psch_status,
        ADD CONSTRAINT chk_psch_status
          CHECK (status IN ('pending','fired','cancelled'))
    `);
  }
}
