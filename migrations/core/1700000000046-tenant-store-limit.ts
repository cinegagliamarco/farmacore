import { MigrationInterface, QueryRunner } from 'typeorm';

// 046, não 044/045: core e shared_catalog compartilham a tabela
// migrations_app, e aqueles timestamps já estão tomados do outro lado.
export class TenantStoreLimit1700000000046 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    // ADD COLUMN nullable sem default é metadata-only, mas o ACCESS EXCLUSIVE
    // pode entrar na fila atrás de uma request longa — e, enfileirado, ele
    // bloqueia todo leitor de core.tenant (ou seja, todo o tráfego de tenant).
    // Falhar o release rápido é melhor que estrangular a API.
    // SET LOCAL, não SET: o migration runner reusa uma conexão para o lote
    // inteiro, então um SET de sessão vazaria o prazo para as migrations
    // seguintes e as faria abortar por conta deste arquivo.
    await qr.query(`SET LOCAL lock_timeout = '3s'`);
    // NULL = sem limite; restringir é ação explícita do system admin via
    // PUT /admin/tenants/:slug/store-limit.
    await qr.query(`ALTER TABLE core.tenant ADD COLUMN store_limit integer`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Rollback costuma rodar sob incidente, com carga: mesmo prazo do up().
    await qr.query(`SET LOCAL lock_timeout = '3s'`);
    await qr.query(`ALTER TABLE core.tenant DROP COLUMN store_limit`);
  }
}
