import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TenantTransactionService } from './tenant-transaction.service';

describe('TenantTransactionService.runWithTenant', () => {
  let svc: TenantTransactionService;
  const queries: string[] = [];
  const fakeManager = {
    query: jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve([]);
    }),
  };
  const fakeDataSource = {
    transaction: jest.fn(async (cb: (em: typeof fakeManager) => Promise<unknown>) =>
      cb(fakeManager),
    ),
  } as unknown as DataSource;

  beforeEach(async () => {
    queries.length = 0;
    fakeManager.query.mockClear();
    const mod = await Test.createTestingModule({
      providers: [
        TenantTransactionService,
        { provide: DataSource, useValue: fakeDataSource },
      ],
    }).compile();
    svc = mod.get(TenantTransactionService);
  });

  it('sets search_path before running the callback', async () => {
    await svc.runWithTenant('tenant_acme', async (em) => {
      await em.query('SELECT 1');
    });
    expect(queries[0]).toMatch(/SET LOCAL search_path TO "tenant_acme", shared_catalog, public/);
    expect(queries[1]).toBe('SELECT 1');
  });

  it('quotes the schema name to defend against injection', async () => {
    await expect(svc.runWithTenant('bad"; DROP --', async () => undefined)).rejects.toThrow(
      /invalid schema/,
    );
  });
});
