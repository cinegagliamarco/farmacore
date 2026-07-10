import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { StoresService } from './stores.service';

interface Call {
  sql: string;
  params: unknown[];
}

/** em.query mock that records calls and resolves by matching the SQL.
 *  `handlers` maps a substring to the rows it should return. */
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
      ['UPDATE core.tenant_store', [{ id: 's1', wasActive: true }]],
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
    const em = buildEm([], [TENANT]); // UPDATE returns []
    await expect(
      service.updateStore(em, 'acme', 's1', { active: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it('re-activation (false → true) DELETEs the store product_item snapshot', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      ['UPDATE core.tenant_store', [{ id: 's1', wasActive: false }]],
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
      ['UPDATE core.tenant_store', [{ id: 's1', wasActive: true }]],
      ['SELECT s.id', [{ id: 's1', active: true }]],
    ]);
    await service.updateStore(em, 'acme', 's1', { active: true });
    expect(calls.some((c) => c.sql.includes('DELETE FROM product_item'))).toBe(
      false,
    );
  });
});

describe('StoresService.deleteCluster', () => {
  let service: StoresService;
  beforeEach(() => (service = new StoresService()));

  it('soft-deletes and detaches member stores', async () => {
    const calls: Call[] = [];
    const em = buildEm(calls, [
      TENANT,
      ['UPDATE core.store_cluster', [{ name: 'Região Sul' }]],
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
    const em = buildEm([], [TENANT]); // soft-delete UPDATE returns []
    await expect(service.deleteCluster(em, 'acme', 'c1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
