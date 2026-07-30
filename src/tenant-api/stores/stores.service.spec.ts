import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { StoresService } from './stores.service';

interface Call {
  sql: string;
  params: unknown[];
}

/** em.query mock that records calls and resolves by matching the SQL.
 *  `handlers` maps a substring to the result it should return — plain rows
 *  for SELECT/INSERT, the pg-driver `[rows, count]` tuple for UPDATE. */
const buildEm = (
  calls: Call[],
  handlers: Array<[string, unknown[]]>,
): EntityManager =>
  ({
    query: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = handlers.find(([needle]) => sql.includes(needle));
      return Promise.resolve(hit ? hit[1] : []);
    },
  }) as unknown as EntityManager;

const TENANT = ['FROM core.tenant WHERE slug', [{ id: 'tenant-1' }]] as [
  string,
  unknown[],
];

/** Linha da query de cota do `updateStore`: `active` é a contagem das OUTRAS
 *  lojas ativas (a própria é excluída), e `wasActive` diz se a loja já estava
 *  ativa. A do `getQuota` tem outra semântica — é montada inline. */
const quota = (
  limit: number | null,
  otherActive: number,
  wasActive = false,
): [string, unknown[]] => [
  'store_limit AS "limit"',
  [{ wasActive, limit, active: String(otherActive) }],
];

describe('StoresService.updateStore', () => {
  let service: StoresService;
  beforeEach(() => (service = new StoresService()));

  it('rejects when no field is provided', async () => {
    const em = buildEm([], [TENANT]);
    await expect(service.updateStore(em, 'acme', 's1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('updates only active and scopes by tenant', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      quota(null, 0),
      ['UPDATE core.tenant_store', [[{ id: 's1', wasActive: true }], 1]],
      [
        'SELECT s.id',
        [
          {
            id: 's1',
            externalId: '9',
            name: 'Loja',
            cnpj: '1',
            active: true,
            clusterId: null,
            clusterName: null,
          },
        ],
      ],
    ]);
    const out = await service.updateStore(em, 'acme', 's1', { active: true });
    const update = calls.find((c) =>
      c.sql.includes('UPDATE core.tenant_store'),
    )!;
    expect(update.sql).toContain('active = $3');
    expect(update.sql).not.toContain('cluster_id =');
    expect(update.params).toEqual(['s1', 'tenant-1', true]);
    expect(out.id).toBe('s1');
  });

  it('validates the cluster belongs to the tenant before attaching', async () => {
    const calls: Call[] = [];
    // store_cluster lookup returns [] → cluster not found.
    const em = buildEm(calls, [TENANT]);
    await expect(
      service.updateStore(em, 'acme', 's1', { clusterId: 'c-missing' }),
    ).rejects.toThrow(NotFoundException);
    expect(calls.some((c) => c.sql.includes('FROM core.store_cluster'))).toBe(
      true,
    );
  });

  it('404s when the store row is missing', async () => {
    const em = buildEm([], [TENANT, ['UPDATE core.tenant_store', [[], 0]]]);
    await expect(
      service.updateStore(em, 'acme', 's1', { active: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it('re-activation (false → true) DELETEs the store product_item snapshot', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      quota(null, 0),
      ['UPDATE core.tenant_store', [[{ id: 's1', wasActive: false }], 1]],
      ['SELECT s.id', [{ id: 's1', active: true }]],
    ]);
    await service.updateStore(em, 'acme', 's1', { active: true });
    // DELETE (não null-out): linha mantida com campos de oferta nulos leria
    // como "loja conhecida, sem caderno" e furaria a guarda de campanha.
    const clear = calls.find((c) => c.sql.includes('DELETE FROM product_item'));
    expect(clear?.sql).toContain('DELETE FROM product_item');
    expect(clear?.params).toEqual(['s1']);
  });

  it('staying active does not clear product_item', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      quota(null, 0),
      ['UPDATE core.tenant_store', [[{ id: 's1', wasActive: true }], 1]],
      ['SELECT s.id', [{ id: 's1', active: true }]],
    ]);
    await service.updateStore(em, 'acme', 's1', { active: true });
    expect(calls.some((c) => c.sql.includes('DELETE FROM product_item'))).toBe(
      false,
    );
  });

  it('activates the last store within the limit, locking the tenant row', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      quota(3, 2),
      ['UPDATE core.tenant_store', [[{ id: 's1', wasActive: false }], 1]],
      ['SELECT s.id', [{ id: 's1', active: true }]],
    ]);
    await service.updateStore(em, 'acme', 's1', { active: true });
    const lockIdx = calls.findIndex((c) => c.sql.includes('FOR NO KEY UPDATE'));
    const countIdx = calls.findIndex((c) =>
      c.sql.includes('store_limit AS "limit"'),
    );
    // Sem o lock, duas ativações simultâneas passam da cota. E a contagem tem
    // que ser um statement DEPOIS do lock: em READ COMMITTED o snapshot do
    // statement é anterior à espera pelo lock, então contar junto leria o
    // total velho e as duas ativações passariam mesmo com o lock.
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(countIdx).toBeGreaterThan(lockIdx);
    expect(calls[lockIdx].sql).not.toContain('count(*)');
    expect(calls[lockIdx].params).toEqual(['tenant-1']);
    const update = calls.find((c) =>
      c.sql.includes('UPDATE core.tenant_store'),
    )!;
    expect(update.params).toEqual(['s1', 'tenant-1', true]);
  });

  it('blocks activation when the store limit is reached', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [TENANT, quota(3, 3)]);
    await expect(
      service.updateStore(em, 'acme', 's1', { active: true }),
    ).rejects.toThrow(ConflictException);
    expect(calls.some((c) => c.sql.includes('UPDATE core.tenant_store'))).toBe(
      false,
    );
  });

  it('already-active store passes even over quota (re-send / cluster edit)', async () => {
    const calls: Call[] = [];
    // limite baixado para 3 com 5 lojas ativas: reenviar active=true numa
    // loja já ativa não pode virar 409, senão ela fica ineditável.
    const em = buildEm(calls, [
      TENANT,
      quota(3, 4, true),
      ['UPDATE core.tenant_store', [[{ id: 's1', wasActive: true }], 1]],
      ['SELECT s.id', [{ id: 's1', active: true }]],
    ]);
    await service.updateStore(em, 'acme', 's1', { active: true });
    const q = calls.find((c) => c.sql.includes('store_limit AS "limit"'))!;
    expect(q.params).toEqual(['tenant-1', 's1']);
  });

  it('503s when the tenant lock times out', async () => {
    const calls: Call[] = [];
    // Fiel ao Postgres: o 55P03 ABORTA a transação, então todo comando
    // seguinte estoura 25P02. Um `SET LOCAL` de limpeza depois do erro
    // (ex.: num finally) estouraria e substituiria o 503 por um 500 —
    // este mock é o que faz esse bug aparecer.
    let aborted = false;
    const em = {
      query: (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (aborted) {
          return Promise.reject(
            Object.assign(new Error('current transaction is aborted'), {
              code: '25P02',
            }),
          );
        }
        if (sql.includes('FOR NO KEY UPDATE')) {
          aborted = true;
          return Promise.reject(
            Object.assign(
              new Error('canceling statement due to lock timeout'),
              {
                code: '55P03',
              },
            ),
          );
        }
        if (sql.includes('FROM core.tenant WHERE slug')) {
          return Promise.resolve([{ id: 'tenant-1' }]);
        }
        return Promise.resolve([]);
      },
    } as unknown as EntityManager;
    await expect(
      service.updateStore(em, 'acme', 's1', { active: true }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(calls.some((c) => c.sql.includes(`lock_timeout = '3s'`))).toBe(true);
  });

  it('locks the store row when reading wasActive', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      quota(null, 0),
      ['UPDATE core.tenant_store', [[{ id: 's1', wasActive: false }], 1]],
      ['SELECT s.id', [{ id: 's1', active: true }]],
    ]);
    await service.updateStore(em, 'acme', 's1', { active: true });
    const q = calls.find((c) => c.sql.includes('store_limit AS "limit"'))!;
    // sem travar a loja, um active=false concorrente deixa wasActive obsoleto
    // e a reativação escapa da cota E do DELETE de product_item.
    expect(q.sql).toContain('FOR NO KEY UPDATE OF st');
  });

  it('404s before the UPDATE when activating a nonexistent store', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [TENANT, ['store_limit AS "limit"', []]]);
    await expect(
      service.updateStore(em, 'acme', 's-missing', { active: true }),
    ).rejects.toThrow(NotFoundException);
    // o 404 vem da query de cota não achar a loja, não de um erro posterior.
    expect(calls.some((c) => c.sql.includes('store_limit AS "limit"'))).toBe(
      true,
    );
    expect(calls.some((c) => c.sql.includes('UPDATE core.tenant_store'))).toBe(
      false,
    );
  });

  it('deactivation skips the quota check', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      ['UPDATE core.tenant_store', [[{ id: 's1', wasActive: true }], 1]],
      ['SELECT s.id', [{ id: 's1', active: false }]],
    ]);
    await service.updateStore(em, 'acme', 's1', { active: false });
    expect(calls.some((c) => c.sql.includes('store_limit AS "limit"'))).toBe(
      false,
    );
  });
});

describe('StoresService.getQuota', () => {
  // Aqui `active` é o total de lojas ativas (sem excluir nenhuma), diferente
  // da contagem da query de cota do updateStore — por isso a linha é inline.
  const row = (limit: number | null, active: number): [string, unknown[]] => [
    'store_limit AS "limit"',
    [{ limit, active: String(active) }],
  ];

  it('returns the limit and active count', async () => {
    const service = new StoresService();
    const em = buildEm([], [TENANT, row(5, 2)]);
    await expect(service.getQuota(em, 'acme')).resolves.toEqual({
      limit: 5,
      active: 2,
    });
  });

  it('returns null limit (unlimited) with the full active count', async () => {
    const calls: Call[] = [];
    const service = new StoresService();
    const em = buildEm(calls, [TENANT, row(null, 4)]);
    await expect(service.getQuota(em, 'acme')).resolves.toEqual({
      limit: null,
      active: 4,
    });
    const q = calls.find((c) => c.sql.includes('store_limit AS "limit"'))!;
    expect(q.params).toEqual(['tenant-1']);
    // getQuota não trava a linha do tenant — é leitura pura.
    expect(calls.some((c) => c.sql.includes('FOR NO KEY UPDATE'))).toBe(false);
  });
});

describe('StoresService.deleteCluster', () => {
  let service: StoresService;
  beforeEach(() => (service = new StoresService()));

  it('soft-deletes and detaches member stores', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      ['UPDATE core.store_cluster', [[{ name: 'Região Sul' }], 1]],
    ]);
    const out = await service.deleteCluster(em, 'acme', 'c1');
    expect(out).toEqual({ id: 'c1', name: 'Região Sul' });
    const detach = calls.find(
      (c) =>
        c.sql.includes('UPDATE core.tenant_store') &&
        c.sql.includes('cluster_id = NULL'),
    );
    expect(detach?.params).toEqual(['c1', 'tenant-1']);
  });

  it('404s when the cluster is missing', async () => {
    const em = buildEm([], [TENANT, ['UPDATE core.store_cluster', [[], 0]]]);
    await expect(service.deleteCluster(em, 'acme', 'c1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
