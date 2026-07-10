import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefreshTokenHashUnique1700000000043 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    // Every /auth/refresh looks up by token_hash; only user_id was indexed.
    await qr.query(
      `CREATE UNIQUE INDEX "UQ_REFRESH_TOKEN_HASH" ON core.refresh_token(token_hash)`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX core."UQ_REFRESH_TOKEN_HASH"`);
  }
}
