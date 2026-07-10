import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { UserEntity } from '../database/entities/core/user.entity';
import { UserRole } from '../database/enums/user-role.enum';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { RefreshTokenEntity } from '../database/entities/core/refresh-token.entity';

interface Setup {
  svc: AuthService;
  passwords: PasswordService;
  users: { findOne: jest.Mock };
  tenants: { findOne: jest.Mock };
  refreshTokens: { save: jest.Mock; findOne: jest.Mock; update: jest.Mock };
}

const setup = async (): Promise<Setup> => {
  const users = { findOne: jest.fn() };
  const tenants = { findOne: jest.fn() };
  const refreshTokens = {
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
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
  return {
    svc: mod.get(AuthService),
    passwords: mod.get(PasswordService),
    users,
    tenants,
    refreshTokens,
  };
};

describe('AuthService.login', () => {
  let s: Setup;

  beforeEach(async () => {
    s = await setup();
  });

  it('rejects unknown tenant', async () => {
    s.tenants.findOne.mockResolvedValue(null);
    await expect(
      s.svc.login({ email: 'a@b.com', password: 'x', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects suspended tenant', async () => {
    s.tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'suspended' });
    await expect(
      s.svc.login({ email: 'a@b.com', password: 'x', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong password', async () => {
    s.tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
    s.users.findOne.mockResolvedValue({
      id: 'u1',
      tenantId: 'acme',
      email: 'a@b.com',
      passwordHash: await s.passwords.hash('right'),
      role: 'viewer',
      status: 'active',
    });
    await expect(
      s.svc.login({ email: 'a@b.com', password: 'wrong', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues tokens on success', async () => {
    s.tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
    s.users.findOne.mockResolvedValue({
      id: 'u1',
      tenantId: 'acme',
      email: 'a@b.com',
      passwordHash: await s.passwords.hash('right'),
      role: UserRole.ADMIN,
      status: 'active',
    });
    const res = await s.svc.login({
      email: 'a@b.com',
      password: 'right',
      tenantSlug: 'acme',
    });
    expect(res.accessToken).toBe('token');
    expect(res.refreshToken).toBeDefined();
    expect(s.refreshTokens.save).toHaveBeenCalled();
  });

  it('burns a dummy hash verification when the user is unknown (uniform timing)', async () => {
    s.tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
    s.users.findOne.mockResolvedValue(null);
    const verify = jest.spyOn(s.passwords, 'verify');
    await expect(
      s.svc.login({ email: 'a@b.com', password: 'x', tenantSlug: 'acme' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).toHaveBeenCalledWith(
      expect.stringContaining('$argon2'),
      'x',
    );
  });
});

describe('AuthService.refresh', () => {
  let s: Setup;

  beforeEach(async () => {
    s = await setup();
    s.refreshTokens.findOne.mockResolvedValue({
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    s.refreshTokens.update.mockResolvedValue({ affected: 1 });
    s.users.findOne.mockResolvedValue({
      id: 'u1',
      tenantId: 'acme',
      role: UserRole.ADMIN,
      status: 'active',
    });
    s.tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
  });

  it('rejects when the tenant is suspended (offboarding kills the 14-day window)', async () => {
    s.tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'suspended' });
    await expect(s.svc.refresh('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the tenant row is gone (soft-deleted)', async () => {
    s.tenants.findOne.mockResolvedValue(null);
    await expect(s.svc.refresh('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotates tokens for an active tenant', async () => {
    const res = await s.svc.refresh('tok');
    expect(res.accessToken).toBe('token');
    expect(s.refreshTokens.save).toHaveBeenCalled();
  });

  it('still issues a pair to the loser of a concurrent rotation (in-grace race)', async () => {
    s.refreshTokens.update.mockResolvedValue({ affected: 0 });
    const res = await s.svc.refresh('tok');
    expect(res.accessToken).toBe('token');
    expect(s.refreshTokens.save).toHaveBeenCalled();
  });

  it('issues a pair on reuse of a token revoked inside the grace window (multi-tab)', async () => {
    s.refreshTokens.findOne.mockResolvedValue({
      userId: 'u1',
      revokedAt: new Date(Date.now() - 30_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await s.svc.refresh('tok');
    expect(res.accessToken).toBe('token');
    // Already revoked: no re-rotation, no family revocation.
    expect(s.refreshTokens.update).not.toHaveBeenCalled();
  });

  it('revokes the whole family and rejects on reuse after the grace window (theft)', async () => {
    s.refreshTokens.findOne.mockResolvedValue({
      userId: 'u1',
      revokedAt: new Date(Date.now() - 61_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(s.svc.refresh('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(s.refreshTokens.update).toHaveBeenCalledWith(
      { userId: 'u1', revokedAt: IsNull() },
      { revokedAt: expect.any(Date) },
    );
    expect(s.refreshTokens.save).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout', () => {
  it('revokes only the user tokens not yet revoked', async () => {
    const s = await setup();
    await s.svc.logout('u1');
    expect(s.refreshTokens.update).toHaveBeenCalledWith(
      { userId: 'u1', revokedAt: IsNull() },
      { revokedAt: expect.any(Date) },
    );
  });
});
