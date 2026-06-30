import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { SyncStoresStep } from './sync-stores.step';
import { UnidadeNegocioEntity } from '../../integration/entities/a7pharma/unidade-negocio.entity';

const buildIntegrationDs = (
  stores: Partial<UnidadeNegocioEntity>[],
): DataSource =>
  ({
    getRepository: (entity: unknown) => {
      if (entity === UnidadeNegocioEntity) {
        return {
          createQueryBuilder: () => {
            const qb = {
              where: () => qb,
              andWhere: () => qb,
              orderBy: () => qb,
              getMany: () => Promise.resolve(stores),
            };
            return qb;
          },
        } as unknown as Repository<UnidadeNegocioEntity>;
      }
      return {} as Repository<ObjectLiteral>;
    },
  }) as unknown as DataSource;

const buildEm = (
  queries: Array<{ sql: string; params: unknown[] }>,
): EntityManager =>
  ({
    query: (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM core.tenant WHERE slug')) {
        return Promise.resolve([{ id: 'tenant-1' }]);
      }
      return Promise.resolve([]);
    },
  }) as unknown as EntityManager;

describe('SyncStoresStep.run', () => {
  let step: SyncStoresStep;
  let queries: Array<{ sql: string; params: unknown[] }>;

  beforeEach(() => {
    step = new SyncStoresStep();
    queries = [];
  });

  it('skips when integration DS is null', async () => {
    const out = await step.run(buildEm(queries), null, 'acme');
    expect(out).toEqual({ processed: 0, skipped: 0 });
  });

  it('upserts active stores by (tenant_id, external_id) and normalizes the cnpj', async () => {
    const ds = buildIntegrationDs([
      { id: 9, cnpj: '12.345.678/0001-90', nomefantasia: 'Loja Centro' },
      { id: 10, cnpj: '99999999000199', razaosocial: 'Loja Sul SA' },
    ]);
    const out = await step.run(buildEm(queries), ds, 'acme');

    expect(out).toEqual({ processed: 2, skipped: 0 });
    const upserts = queries.filter((q) =>
      q.sql.includes('INSERT INTO core.tenant_store'),
    );
    expect(upserts).toHaveLength(2);
    // cnpj normalized to digits; name from nomefantasia; external_id from id.
    expect(upserts[0].params).toEqual([
      'tenant-1',
      '9',
      'Loja Centro',
      '12345678000190',
    ]);
    expect(upserts[1].params).toEqual([
      'tenant-1',
      '10',
      'Loja Sul SA',
      '99999999000199',
    ]);
    // inserts active=false; matches on the stable external_id key (not cnpj,
    // which is NULL on legacy rows); never overwrites active on conflict.
    expect(upserts[0].sql).toContain('VALUES ($1, $2, $3, $4, false)');
    expect(upserts[0].sql).toContain('ON CONFLICT (tenant_id, external_id)');
    expect(upserts[0].sql).not.toMatch(/SET[\s\S]*active/);
  });

  it('skips stores without a cnpj', async () => {
    const ds = buildIntegrationDs([
      { id: 9, cnpj: undefined, nome: 'No CNPJ' },
      { id: 10, cnpj: '   ', nome: 'Blank CNPJ' },
      { id: 11, cnpj: '11111111000111', nome: 'Good' },
    ]);
    const out = await step.run(buildEm(queries), ds, 'acme');

    expect(out).toEqual({ processed: 1, skipped: 2 });
    const upserts = queries.filter((q) =>
      q.sql.includes('INSERT INTO core.tenant_store'),
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0].params[1]).toBe('11');
  });
});
