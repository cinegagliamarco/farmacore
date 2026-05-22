import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { LessThan, Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import { UserEntity, UserRole } from '../database/entities/core/user.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { RefreshTokenEntity } from '../database/entities/core/refresh-token.entity';
import { PasswordService } from './password.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { JwtPayload } from './jwt-payload.type';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokens: Repository<RefreshTokenEntity>,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  public async login(dto: LoginDto): Promise<LoginResponseDto> {
    const tenant = await this.tenants.findOne({ where: { slug: dto.tenantSlug } });
    if (!tenant || tenant.status === 'suspended') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.users.findOne({
      where: { tenantId: dto.tenantSlug, email: dto.email },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  public async refresh(refreshToken: string): Promise<LoginResponseDto> {
    const hash = this.hashToken(refreshToken);
    const row = await this.refreshTokens.findOne({ where: { tokenHash: hash } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    row.revokedAt = new Date();
    await this.refreshTokens.save(row);
    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  public async logout(userId: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, expiresAt: LessThan(new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)) },
      { revokedAt: new Date() },
    );
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    role: UserRole,
  ): Promise<LoginResponseDto> {
    const payload: JwtPayload = { sub: userId, tenantId, role };
    const accessToken = this.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
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
