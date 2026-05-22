import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';

jest.mock('typeorm', () => {
  const actual = jest.requireActual<typeof import('typeorm')>('typeorm');
  return {
    ...actual,
    DataSource: jest.fn().mockImplementation(() => ({
      isInitialized: false,
      initialize: jest
        .fn()
        .mockImplementation(function (this: { isInitialized: boolean }) {
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

  beforeEach(async () => {
    (DataSource as unknown as jest.Mock).mockClear();
    repo = { findOne: jest.fn(), manager: { findOne: jest.fn() } };
    crypto = { decrypt: jest.fn().mockResolvedValue('secret') };
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
    repo.findOne.mockResolvedValue({
      tenantId: 'tid',
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
    });
    const a = await factory.forTenant('tid');
    const b = await factory.forTenant('tid');
    expect(a).toBe(b);
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(DataSource).toHaveBeenCalledTimes(1);
  });

  it('invalidate destroys and removes from cache', async () => {
    repo.findOne.mockResolvedValue({
      tenantId: 'tid',
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
    });
    const ds = await factory.forTenant('tid');
    await factory.invalidate('tid');
    expect((ds as { destroy: jest.Mock }).destroy).toHaveBeenCalled();
    await factory.forTenant('tid');
    expect(repo.findOne).toHaveBeenCalledTimes(2);
  });
});
