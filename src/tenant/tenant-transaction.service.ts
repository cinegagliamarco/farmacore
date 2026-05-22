import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

const VALID_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;

@Injectable()
export class TenantTransactionService {
  constructor(private readonly dataSource: DataSource) {}

  public async runWithTenant<T>(
    schemaName: string,
    fn: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (!VALID_SCHEMA.test(schemaName)) {
      throw new Error(`invalid schema name: ${schemaName}`);
    }
    return this.dataSource.transaction(async (em) => {
      await em.query(`SET LOCAL search_path TO "${schemaName}", shared_catalog, public`);
      return fn(em);
    });
  }
}
