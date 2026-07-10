import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { IsNull, Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import { UserEntity } from '../database/entities/core/user.entity';
import { UserRole } from '../database/enums/user-role.enum';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { TenantStatus } from '../database/enums/tenant-status.enum';
import { RefreshTokenEntity } from '../database/entities/core/refresh-token.entity';
import { PasswordService } from './password.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { JwtPayload } from './jwt-payload.type';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14;
// Reuse of a just-rotated refresh token within this window is a benign
// multi-tab race (tabs share localStorage); late reuse is treated as theft.
// ONLY rotation gets the grace: logout and family revocation backdate
// revokedAt by GRACE_MS so an administratively revoked token can never
// ride the window back into a session.
const GRACE_MS = 60_000;
// Static argon2id hash of a random string (never a real password). Verified
// when the tenant/user lookup fails so a miss costs the same ~100ms as a
// wrong password — no user-enumeration timing oracle.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$emFoifpTW+pPSKKpEXxWqw$10xBZf7w3NUYgtqkBmo5CSolTR6qeXOlygCVzYUe8EU';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokens: Repository<RefreshTokenEntity>,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  public async login(dto: LoginDto): Promise<LoginResponseDto> {
    const [tenant, user] = await Promise.all([
      this.tenants.findOne({ where: { slug: dto.tenantSlug } }),
      this.users.findOne({
        where: { tenantId: dto.tenantSlug, email: dto.email },
      }),
    ]);
    if (
      !tenant ||
      tenant.status === TenantStatus.SUSPENDED ||
      !user ||
      user.status !== 'active'
    ) {
      await this.passwords.verify(DUMMY_PASSWORD_HASH, dto.password);
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  public async refresh(refreshToken: string): Promise<LoginResponseDto> {
    const hash = this.hashToken(refreshToken);
    const row = await this.refreshTokens.findOne({
      where: { tokenHash: hash },
    });
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    // Reuse detection runs before the expiry check so presenting a stale
    // stolen token still nukes the family.
    if (row.revokedAt && Date.now() - row.revokedAt.getTime() >= GRACE_MS) {
      // Reuse long after rotation = stolen token: revoke the whole family.
      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Espelha o login: tenant suspenso/offboardado não renova a sessão —
    // sem isso o refresh token mantém o acesso vivo por até 14 dias.
    const tenant = await this.tenants.findOne({
      where: { slug: user.tenantId },
    });
    if (!tenant || tenant.status === TenantStatus.SUSPENDED) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!row.revokedAt) {
      // Atomic rotation: only one concurrent refresh flips revoked_at. Losing
      // the race (affected 0) is the same benign in-grace reuse handled above,
      // so the loser still gets a fresh pair.
      await this.refreshTokens.update(
        { tokenHash: hash, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    }
    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  public async logout(userId: string): Promise<void> {
    await this.revokeAllForUser(userId);
  }

  /** Administrative revocation (logout / theft response): backdated past
   *  GRACE_MS so the revoked tokens land outside the rotation-reuse grace
   *  window and can never mint a new session. */
  private async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(Date.now() - GRACE_MS) },
    );
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    role: UserRole,
  ): Promise<LoginResponseDto> {
    const payload: JwtPayload = { sub: userId, tenantId, role };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    await this.refreshTokens.save({
      userId,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  private hashToken(plain: string): string {
    return crypto.createHash('sha256').update(plain).digest('hex');
  }
}
