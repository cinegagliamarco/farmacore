import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { UserEntity } from '../database/entities/core/user.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { RefreshTokenEntity } from '../database/entities/core/refresh-token.entity';

describe('AuthService.login', () => {
  let svc: AuthService;
  let users: { findOne: jest.Mock };
  let tenants: { findOne: jest.Mock };
  let refreshTokens: { save: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let passwords: PasswordService;

  beforeEach(async () => {
    users = { findOne: jest.fn() };
    tenants = { findOne: jest.fn() };
    refreshTokens = { save: jest.fn(), findOne: jest.fn(), update: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: getRepositoryToken(TenantEntity), useValue: tenants },
        {
          provide: getRepositoryToken(RefreshTokenEntity),
          useValue: refreshTokens,
        },
        {
          provide: JwtService,
          useValue: {
            sign: () => 'token',
            verifyAsync: (): Promise<unknown> => Promise.resolve({}),
          },
        },
      ],
    }).compile();
    svc = mod.get(AuthService);
    passwords = mod.get(PasswordService);
  });

  it('rejects unknown tenant', async () => {
    tenants.findOne.mockResolvedValue(null);
    await expect(
      svc.login({ email: 'a@b.com', password: 'x', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects suspended tenant', async () => {
    tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'suspended' });
    await expect(
      svc.login({ email: 'a@b.com', password: 'x', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong password', async () => {
    tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
    users.findOne.mockResolvedValue({
      id: 'u1',
      tenantId: 'acme',
      email: 'a@b.com',
      passwordHash: await passwords.hash('right'),
      role: 'viewer',
      status: 'active',
    });
    await expect(
      svc.login({ email: 'a@b.com', password: 'wrong', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues tokens on success', async () => {
    tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
    users.findOne.mockResolvedValue({
      id: 'u1',
      tenantId: 'acme',
      email: 'a@b.com',
      passwordHash: await passwords.hash('right'),
      role: 'admin',
      status: 'active',
    });
    const res = await svc.login({
      email: 'a@b.com',
      password: 'right',
      tenantSlug: 'acme',
    });
    expect(res.accessToken).toBe('token');
    expect(res.refreshToken).toBeDefined();
    expect(refreshTokens.save).toHaveBeenCalled();
  });
});
