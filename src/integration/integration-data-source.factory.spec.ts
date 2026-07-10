import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { A7PHARMA_ENTITIES } from './entities';

jest.mock('typeorm', () => {
  const actual = jest.requireActual<typeof import('typeorm')>('typeorm');
  return {
    ...actual,
    DataSource: jest.fn().mockImplementation(() => ({
      isInitialized: false,
      initialize: jest.fn().mockImplementation(function (this: {
        isInitialized: boolean;
      }) {
        this.isInitialized = true;
        return Promise.resolve(this);
      }),
      query: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('IntegrationDataSourceFactory', () => {
  let factory: IntegrationDataSourceFactory;
  let repo: { findOne: jest.Mock; manager: { findOne: jest.Mock } };
  let crypto: { decrypt: jest.Mock };
  const cipher = Buffer.from('cipher');

  const row = (overrides: Record<string, unknown> = {}) => ({
    tenantId: 'tid',
    origin: 'a7pharma',
    host: 'h',
    port: 5432,
    database: 'd',
    username: 'u',
    passwordEncrypted: cipher,
    sslMode: 'require',
    sslCaCert: null,
    type: 'postgres',
    readOnly: true,
    connectionOptions: {},
    status: 'active',
    ...overrides,
  });

  beforeEach(async () => {
    (DataSource as unknown as jest.Mock).mockClear();
    repo = { findOne: jest.fn(), manager: { findOne: jest.fn() } };
    crypto = { decrypt: jest.fn().mockReturnValue('secret') };
    const mod = await Test.createTestingModule({
      providers: [
        IntegrationDataSourceFactory,
        {
          provide: getRepositoryToken(IntegrationDatabaseConnectionEntity),
          useValue: repo,
        },
        { provide: CredentialEncryptionService, useValue: crypto },
      ],
    }).compile();
    factory = mod.get(IntegrationDataSourceFactory);
  });

  it('returns null when no row exists', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(factory.forTenant('tid')).resolves.toBeNull();
  });

  it('initializes and caches the DataSource', async () => {
    repo.findOne.mockResolvedValue(row());
    const a = await factory.forTenant('tid');
    const b = await factory.forTenant('tid');
    expect(a).toBe(b);
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(DataSource).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent calls for the same tenant', async () => {
    repo.findOne.mockResolvedValue(row());
    const [a, b] = await Promise.all([
      factory.forTenant('tid'),
      factory.forTenant('tid'),
    ]);
    expect(a).toBe(b);
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(DataSource).toHaveBeenCalledTimes(1);
  });

  it('evicts a failed connect from the cache and retries on the next call', async () => {
    repo.findOne.mockRejectedValueOnce(new Error('db down'));
    await expect(factory.forTenant('tid')).rejects.toThrow('db down');
    repo.findOne.mockResolvedValue(row());
    await expect(factory.forTenant('tid')).resolves.not.toBeNull();
    expect(repo.findOne).toHaveBeenCalledTimes(2);
  });

  it('passes the read-only startup option only when row.readOnly', async () => {
    repo.findOne
      .mockResolvedValueOnce(row({ readOnly: true, tenantId: 'ro' }))
      .mockResolvedValueOnce(row({ readOnly: false, tenantId: 'rw' }));
    await factory.forTenant('ro');
    await factory.forTenant('rw');
    const calls = (DataSource as unknown as jest.Mock).mock.calls as Array<
      [{ extra: { options?: string } }]
    >;
    expect(calls[0][0].extra.options).toContain(
      '-c default_transaction_read_only=on',
    );
    expect(calls[1][0].extra.options).toBeUndefined();
  });

  it('loads the entity set for the row.origin (a7pharma)', async () => {
    repo.findOne.mockResolvedValue(
      row({ sslMode: 'disable', readOnly: false }),
    );
    await factory.forTenant('tid');
    const ctorArg = (DataSource as unknown as jest.Mock).mock.calls[0][0] as {
      entities: unknown[];
    };
    expect(ctorArg.entities).toHaveLength(A7PHARMA_ENTITIES.length);
    expect(ctorArg.entities).toEqual(
      expect.arrayContaining([...A7PHARMA_ENTITIES]),
    );
  });

  it('invalidate destroys and removes from cache', async () => {
    repo.findOne.mockResolvedValue(row());
    const ds = await factory.forTenant('tid');
    await factory.invalidate('tid');
    expect(
      (ds as unknown as { destroy: jest.Mock }).destroy,
    ).toHaveBeenCalled();
    await factory.forTenant('tid');
    expect(repo.findOne).toHaveBeenCalledTimes(2);
  });
});
