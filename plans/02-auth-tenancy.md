# 02 — Auth & Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status: ✅ Executed.** Plan 02 was executed. Deviation: `SearchPathInterceptor` no longer injects `TenantContext` (Nest 11 fails to resolve `Reflector` when a global `APP_INTERCEPTOR` depends on a `Scope.REQUEST` provider); it reads `JwtPayload` directly off `req.user`. `TenantContext` is still exported for services/controllers.

**Goal:** Implement JWT auth + multi-tenant request routing. Every authenticated request lands in a transaction with `search_path = tenant_<slug>, shared_catalog, public` so unqualified table references resolve to the tenant's schema. Workers do the same per message handler.

**Architecture:** A global `JwtAuthGuard` validates tokens. A request-scoped `TenantContext` provider extracts `tenantId`/`schemaName` from the JWT and is injected into services. A `SearchPathInterceptor` wraps each request in a TypeORM transaction and issues `SET LOCAL search_path` as the first statement. A shared helper `runWithTenant(schemaName, fn)` provides the equivalent for worker consumers (used in plan 04+).

**Tech Stack:** `@nestjs/passport`, `passport-jwt`, `argon2`, `class-validator`, TypeORM transactions via `EntityManager`.

**Reference:** `arc/03-auth-and-tenancy.md` in full.

---

## Interfaces Exposed

- **Modules:**
  - `AuthModule` — login, refresh, logout.
  - `TenantModule` — `TenantContext` (request-scoped), `TenantService` (lookup by slug), `runWithTenant()` helper.
- **DI tokens / providers:**
  - `TenantContext` — request-scoped provider with `{ tenantId, slug, schemaName, role, userId }`.
  - `TenantTransactionService` — exposes `runWithTenant<T>(schemaName: string, fn: (em: EntityManager) => Promise<T>): Promise<T>`. **All worker code uses this.**
- **Guards / decorators:**
  - `@UseGuards(JwtAuthGuard)` — applied globally via `APP_GUARD`.
  - `@Public()` — skip JWT for `/health`, `/auth/login`, `/auth/refresh`.
  - `@Roles('admin' | 'operator' | 'viewer')` + `RolesGuard`.
  - `@CurrentUser()` param decorator — returns `{ userId, tenantId, role }`.
- **DTOs:**
  - `LoginDto { email: string; password: string; tenantSlug: string }`
  - `LoginResponseDto { accessToken: string; refreshToken: string; expiresIn: number }`
  - `RefreshDto { refreshToken: string }`
- **HTTP endpoints:**
  - `POST /auth/login` → `LoginResponseDto`
  - `POST /auth/refresh` → `LoginResponseDto`
  - `POST /auth/logout` (auth required)
  - `GET /auth/me` (auth required) → current user + tenant

---

## File Structure

```
src/auth/
├─ auth.module.ts
├─ auth.controller.ts
├─ auth.service.ts
├─ password.service.ts                 # argon2id wrapper
├─ jwt.strategy.ts                     # passport-jwt strategy
├─ guards/
│  ├─ jwt-auth.guard.ts
│  └─ roles.guard.ts
├─ decorators/
│  ├─ public.decorator.ts
│  ├─ roles.decorator.ts
│  └─ current-user.decorator.ts
└─ dto/
   ├─ login.dto.ts
   ├─ login-response.dto.ts
   └─ refresh.dto.ts

src/tenant/
├─ tenant.module.ts
├─ tenant.service.ts                   # CRUD against core.tenant
├─ tenant.context.ts                   # request-scoped context
├─ tenant-transaction.service.ts       # runWithTenant() helper
└─ interceptors/
   └─ search-path.interceptor.ts
```

---

### Task 1: Install auth deps

- [x] **Step 1: Install**

```bash
npm install @nestjs/passport @nestjs/jwt passport passport-jwt argon2
npm install -D @types/passport-jwt
```

- [x] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(auth): install passport-jwt + argon2"
```

---

### Task 2: Wire entities into DI

**Files:** `src/database/database.module.ts` modify; `src/tenant/tenant.module.ts` create.

- [x] **Step 1: Register entities with TypeOrmModule.forFeature**

Modify `src/database/database.module.ts` to expose a feature module for core entities:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { TenantEntity } from './entities/core/tenant.entity';
import { UserEntity } from './entities/core/user.entity';
import { RefreshTokenEntity } from './entities/core/refresh-token.entity';
import { PipelineRunEntity } from './entities/core/pipeline-run.entity';
import { IntegrationDatabaseConnectionEntity } from './entities/core/integration-database-connection.entity';

const CORE_ENTITIES = [
  TenantEntity, UserEntity, RefreshTokenEntity, PipelineRunEntity,
  IntegrationDatabaseConnectionEntity,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        type: 'postgres',
        url: config.databaseUrl,
        ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
        entities: CORE_ENTITIES, // tenant entities are loaded per-feature module
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature(CORE_ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
```

- [x] **Step 2: Commit**

```bash
git add src/database/database.module.ts
git commit -m "feat(db): register core entities for DI"
```

---

### Task 3: PasswordService

**Files:** `src/auth/password.service.ts`, `src/auth/password.service.spec.ts`

- [x] **Step 1: Failing test**

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hash returns a different string than the input', async () => {
    const hash = await svc.hash('secret123');
    expect(hash).not.toBe('secret123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verify returns true for the right password', async () => {
    const hash = await svc.hash('secret123');
    await expect(svc.verify(hash, 'secret123')).resolves.toBe(true);
  });

  it('verify returns false for the wrong password', async () => {
    const hash = await svc.hash('secret123');
    await expect(svc.verify(hash, 'wrong')).resolves.toBe(false);
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/auth/password.service.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  public async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  public async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/auth/password.service.spec.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/auth/password.service.ts src/auth/password.service.spec.ts
git commit -m "feat(auth): argon2id PasswordService"
```

---

### Task 4: JWT payload types and DTOs

**Files:** `src/auth/dto/`, `src/auth/jwt-payload.type.ts`

- [x] **Step 1: jwt-payload.type.ts**

```ts
import type { UserRole } from '../database/entities/core/user.entity';

export interface JwtPayload {
  sub: string;        // user id
  tenantId: string;   // tenant slug
  role: UserRole;
  iat?: number;
  exp?: number;
}
```

- [x] **Step 2: dto/login.dto.ts**

```ts
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 256)
  password!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,31}$/, { message: 'tenantSlug must be a valid slug' })
  tenantSlug!: string;
}
```

- [x] **Step 3: dto/login-response.dto.ts**

```ts
export class LoginResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresIn!: number;
}
```

- [x] **Step 4: dto/refresh.dto.ts**

```ts
import { IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}
```

- [x] **Step 5: Commit**

```bash
git add src/auth/dto/ src/auth/jwt-payload.type.ts
git commit -m "feat(auth): DTOs and JwtPayload type"
```

---

### Task 5: AuthService

**Files:** `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`

- [x] **Step 1: Failing test**

```ts
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
  let refreshTokens: { save: jest.Mock };
  let passwords: PasswordService;

  beforeEach(async () => {
    users = { findOne: jest.fn() };
    tenants = { findOne: jest.fn() };
    refreshTokens = { save: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: getRepositoryToken(TenantEntity), useValue: tenants },
        { provide: getRepositoryToken(RefreshTokenEntity), useValue: refreshTokens },
        { provide: JwtService, useValue: { sign: () => 'token', verifyAsync: async () => ({}) } },
      ],
    }).compile();
    svc = mod.get(AuthService);
    passwords = mod.get(PasswordService);
  });

  it('rejects unknown tenant', async () => {
    tenants.findOne.mockResolvedValue(null);
    await expect(svc.login({ email: 'a@b.com', password: 'x', tenantSlug: 'acme' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects suspended tenant', async () => {
    tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'suspended' });
    await expect(svc.login({ email: 'a@b.com', password: 'x', tenantSlug: 'acme' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong password', async () => {
    tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
    users.findOne.mockResolvedValue({ id: 'u1', tenantId: 'acme', email: 'a@b.com', passwordHash: await passwords.hash('right'), role: 'viewer', status: 'active' });
    await expect(svc.login({ email: 'a@b.com', password: 'wrong', tenantSlug: 'acme' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues tokens on success', async () => {
    tenants.findOne.mockResolvedValue({ slug: 'acme', status: 'active' });
    users.findOne.mockResolvedValue({ id: 'u1', tenantId: 'acme', email: 'a@b.com', passwordHash: await passwords.hash('right'), role: 'admin', status: 'active' });
    const res = await svc.login({ email: 'a@b.com', password: 'right', tenantSlug: 'acme' });
    expect(res.accessToken).toBe('token');
    expect(res.refreshToken).toBeDefined();
    expect(refreshTokens.save).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/auth/auth.service.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import { UserEntity } from '../database/entities/core/user.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { RefreshTokenEntity } from '../database/entities/core/refresh-token.entity';
import { PasswordService } from './password.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { JwtPayload } from './jwt-payload.type';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;            // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(RefreshTokenEntity) private readonly refreshTokens: Repository<RefreshTokenEntity>,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  public async login(dto: LoginDto): Promise<LoginResponseDto> {
    const tenant = await this.tenants.findOne({ where: { slug: dto.tenantSlug } });
    if (!tenant || tenant.status === 'suspended') throw new UnauthorizedException('Invalid credentials');

    const user = await this.users.findOne({ where: { tenantId: dto.tenantSlug, email: dto.email } });
    if (!user || user.status !== 'active') throw new UnauthorizedException('Invalid credentials');

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  public async refresh(refreshToken: string): Promise<LoginResponseDto> {
    const hash = this.hashToken(refreshToken);
    const row = await this.refreshTokens.findOne({ where: { tokenHash: hash } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user || user.status !== 'active') throw new UnauthorizedException('Invalid refresh token');

    // Rotate
    row.revokedAt = new Date();
    await this.refreshTokens.save(row);
    return this.issueTokens(user.id, user.tenantId, user.role);
  }

  public async logout(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: undefined }, { revokedAt: new Date() });
  }

  private async issueTokens(userId: string, tenantId: string, role: UserEntity['role']): Promise<LoginResponseDto> {
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
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/auth/auth.service.spec.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): AuthService with login/refresh/logout"
```

---

### Task 6: JWT strategy + guard

**Files:** `src/auth/jwt.strategy.ts`, `src/auth/guards/jwt-auth.guard.ts`, `src/auth/decorators/public.decorator.ts`

- [x] **Step 1: Public decorator**

```ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
```

- [x] **Step 2: JWT strategy**

```ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../config/app-config.service';
import { JwtPayload } from './jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      algorithms: ['HS256'],
    });
  }

  public async validate(payload: JwtPayload): Promise<JwtPayload> {
    return payload;   // attached to req.user
  }
}
```

- [x] **Step 3: Guard with @Public() bypass**

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }

  public override canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context) as boolean | Promise<boolean>;
  }
}
```

- [x] **Step 4: Commit**

```bash
git add src/auth/jwt.strategy.ts src/auth/guards/jwt-auth.guard.ts src/auth/decorators/public.decorator.ts
git commit -m "feat(auth): JWT strategy + global guard with @Public bypass"
```

---

### Task 7: Roles guard + decorator

**Files:** `src/auth/decorators/roles.decorator.ts`, `src/auth/guards/roles.guard.ts`

- [x] **Step 1: Decorator**

```ts
import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../database/entities/core/user.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

- [x] **Step 2: Guard**

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole } from '../../database/entities/core/user.entity';
import type { JwtPayload } from '../jwt-payload.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const role = req.user?.role;
    if (!role || !required.includes(role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
```

- [x] **Step 3: Commit**

```bash
git add src/auth/decorators/roles.decorator.ts src/auth/guards/roles.guard.ts
git commit -m "feat(auth): @Roles decorator + RolesGuard"
```

---

### Task 8: CurrentUser decorator

**Files:** `src/auth/decorators/current-user.decorator.ts`

- [x] **Step 1: Implement**

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../jwt-payload.type';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return req.user;
  },
);
```

- [x] **Step 2: Commit**

```bash
git add src/auth/decorators/current-user.decorator.ts
git commit -m "feat(auth): @CurrentUser param decorator"
```

---

### Task 9: AuthController

**Files:** `src/auth/auth.controller.ts`

- [x] **Step 1: Implement**

```ts
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  public login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  public refresh(@Body() dto: RefreshDto): Promise<LoginResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  public async logout(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.auth.logout(user.sub);
  }

  @Get('me')
  public me(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/auth/auth.controller.ts
git commit -m "feat(auth): AuthController endpoints"
```

---

### Task 10: AuthModule

**Files:** `src/auth/auth.module.ts`

- [x] **Step 1: Implement**

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { UserEntity } from '../database/entities/core/user.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { RefreshTokenEntity } from '../database/entities/core/refresh-token.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    TypeOrmModule.forFeature([UserEntity, TenantEntity, RefreshTokenEntity]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
```

- [x] **Step 2: Commit**

```bash
git add src/auth/auth.module.ts
git commit -m "feat(auth): AuthModule with global JWT + Roles guards"
```

---

### Task 11: TenantService

**Files:** `src/tenant/tenant.service.ts`

- [x] **Step 1: Implement**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { TenantStatus } from '../database/enums/tenant-status.enum';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity) private readonly repo: Repository<TenantEntity>,
  ) {}

  public async findBySlug(slug: string): Promise<TenantEntity> {
    const t = await this.repo.findOne({ where: { slug } });
    if (!t) throw new NotFoundException(`Tenant ${slug} not found`);
    return t;
  }

  public async findActive(slug: string): Promise<TenantEntity> {
    const t = await this.findBySlug(slug);
    if (t.status !== TenantStatus.ACTIVE) throw new NotFoundException(`Tenant ${slug} is not active`);
    return t;
  }

  public listActive(): Promise<TenantEntity[]> {
    return this.repo.find({ where: { status: TenantStatus.ACTIVE } });
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/tenant/tenant.service.ts
git commit -m "feat(tenant): TenantService lookup helpers"
```

---

### Task 12: TenantContext (request-scoped)

**Files:** `src/tenant/tenant.context.ts`

The `TenantContext` is request-scoped — Nest will create a new instance per HTTP request. It reads the JWT payload that `JwtStrategy.validate()` attached to `req.user`.

- [x] **Step 1: Implement**

```ts
import { Inject, Injectable, Scope, UnauthorizedException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/jwt-payload.type';

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private readonly payload: JwtPayload | null;

  constructor(@Inject(REQUEST) req: Request & { user?: JwtPayload }) {
    this.payload = req.user ?? null;
  }

  private require(): JwtPayload {
    if (!this.payload) throw new UnauthorizedException('No tenant context');
    return this.payload;
  }

  public get userId(): string { return this.require().sub; }
  public get tenantSlug(): string { return this.require().tenantId; }
  public get role(): JwtPayload['role'] { return this.require().role; }

  public get schemaName(): string {
    const slug = this.tenantSlug;
    return slug === 'system' ? 'system' : `tenant_${slug.replace(/-/g, '_')}`;
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/tenant/tenant.context.ts
git commit -m "feat(tenant): request-scoped TenantContext"
```

---

### Task 13: TenantTransactionService (runWithTenant)

**Files:** `src/tenant/tenant-transaction.service.ts`, `src/tenant/tenant-transaction.service.spec.ts`

This service is the single point of truth for "run something inside a transaction with the correct `search_path`". Both the HTTP interceptor and the queue consumers go through it.

- [x] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TenantTransactionService } from './tenant-transaction.service';

describe('TenantTransactionService.runWithTenant', () => {
  let svc: TenantTransactionService;
  const queries: string[] = [];
  const fakeManager = { query: jest.fn((sql: string) => { queries.push(sql); return Promise.resolve([]); }) };
  const fakeDataSource = {
    transaction: jest.fn(async (cb: (em: typeof fakeManager) => Promise<unknown>) => cb(fakeManager)),
  } as unknown as DataSource;

  beforeEach(async () => {
    queries.length = 0;
    fakeManager.query.mockClear();
    const mod = await Test.createTestingModule({
      providers: [TenantTransactionService, { provide: DataSource, useValue: fakeDataSource }],
    }).compile();
    svc = mod.get(TenantTransactionService);
  });

  it('sets search_path before running the callback', async () => {
    await svc.runWithTenant('tenant_acme', async (em) => { await em.query('SELECT 1'); });
    expect(queries[0]).toMatch(/SET LOCAL search_path TO "tenant_acme", shared_catalog, public/);
    expect(queries[1]).toBe('SELECT 1');
  });

  it('quotes the schema name to defend against injection', async () => {
    await expect(svc.runWithTenant('bad"; DROP --', async () => {})).rejects.toThrow(/invalid schema/);
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/tenant/tenant-transaction.service.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

const VALID_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;

@Injectable()
export class TenantTransactionService {
  constructor(private readonly dataSource: DataSource) {}

  public runWithTenant<T>(schemaName: string, fn: (em: EntityManager) => Promise<T>): Promise<T> {
    if (!VALID_SCHEMA.test(schemaName)) {
      throw new Error(`invalid schema name: ${schemaName}`);
    }
    return this.dataSource.transaction(async (em) => {
      await em.query(`SET LOCAL search_path TO "${schemaName}", shared_catalog, public`);
      return fn(em);
    });
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/tenant/tenant-transaction.service.spec.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src/tenant/tenant-transaction.service.ts src/tenant/tenant-transaction.service.spec.ts
git commit -m "feat(tenant): runWithTenant() helper with schema-name validation"
```

---

### Task 14: SearchPathInterceptor

**Files:** `src/tenant/interceptors/search-path.interceptor.ts`

The interceptor wraps each request in `runWithTenant`, then attaches the `EntityManager` to `req.entityManager` so request-scoped repos (introduced in plan 06) can pick it up. For v1 we use `TenantTransactionService` directly — services in this plan still issue their own queries; the interceptor only ensures the `SET LOCAL` happens.

> **Trade-off:** Wrapping the whole HTTP request in one TypeORM transaction means request-level rollback on error. This matches the arc spec (`arc/03 §5 "NestJS wiring"`). The interceptor SKIPS routes marked `@Public()` (login/refresh don't have a tenant context yet).

- [x] **Step 1: Implement**

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, switchMap } from 'rxjs';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { TenantContext } from '../tenant.context';
import { TenantTransactionService } from '../tenant-transaction.service';

@Injectable()
export class SearchPathInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
    private readonly txService: TenantTransactionService,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { entityManager?: EntityManager }>();
    const schemaName = this.tenantContext.schemaName;

    return from(
      this.txService.runWithTenant(schemaName, async (em) => {
        req.entityManager = em;
        // Convert the downstream Observable into a Promise so it runs inside the tx.
        return new Promise<unknown>((resolve, reject) => {
          next.handle().subscribe({ next: resolve, error: reject });
        });
      }),
    ).pipe(switchMap((value) => from([value])));
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/tenant/interceptors/search-path.interceptor.ts
git commit -m "feat(tenant): SearchPathInterceptor — per-request tx + search_path"
```

---

### Task 15: TenantModule

**Files:** `src/tenant/tenant.module.ts`

- [x] **Step 1: Implement**

```ts
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { TenantService } from './tenant.service';
import { TenantContext } from './tenant.context';
import { TenantTransactionService } from './tenant-transaction.service';
import { SearchPathInterceptor } from './interceptors/search-path.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  providers: [
    TenantService,
    TenantContext,
    TenantTransactionService,
    { provide: APP_INTERCEPTOR, useClass: SearchPathInterceptor },
  ],
  exports: [TenantService, TenantContext, TenantTransactionService],
})
export class TenantModule {}
```

- [x] **Step 2: Commit**

```bash
git add src/tenant/tenant.module.ts
git commit -m "feat(tenant): TenantModule wires context, service, interceptor"
```

---

### Task 16: Compose AppModule

**Files:** `src/app.module.ts`

- [x] **Step 1: Add new modules**

```ts
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { LoggerModule } from './logger/logger.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';

@Module({
  imports: [AppConfigModule, LoggerModule, DatabaseModule, HealthModule, AuthModule, TenantModule],
  providers: [
    { provide: APP_PIPE, useFactory: () => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
  ],
})
export class AppModule {}
```

- [x] **Step 2: Commit**

```bash
git add src/app.module.ts
git commit -m "feat: compose AuthModule + TenantModule into AppModule"
```

---

### Task 17: Seed a `system` admin user (dev convenience)

**Files:** `scripts/seed-system-admin.ts`

Useful for local dev so admin endpoints (plan 06) can be exercised before any tenants exist.

- [x] **Step 1: Implement**

```ts
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@system.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme-please-32-chars-or-more';
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 chars');

  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const ds = new DataSource({ type: 'postgres', url, entities: [], synchronize: false });
  await ds.initialize();
  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ('system', $1, $2, 'admin', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [email, hash],
    );
    console.log(`System admin upserted: ${email}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [x] **Step 2: Add script alias**

In `package.json` `scripts`: `"seed:system-admin": "ts-node scripts/seed-system-admin.ts"`

- [x] **Step 3: Run it locally**

```bash
SEED_ADMIN_EMAIL=admin@system.local SEED_ADMIN_PASSWORD=devpassword-please-change \
  npm run seed:system-admin
```

Expected: prints `System admin upserted: admin@system.local`.

- [x] **Step 4: Commit**

```bash
git add scripts/seed-system-admin.ts package.json
git commit -m "feat(auth): seed system admin script for dev"
```

---

### Task 18: e2e smoke test for login + tenant isolation

**Files:** `test/auth-tenant.e2e-spec.ts`, `test/jest-e2e.json`

- [x] **Step 1: Confirm `test/jest-e2e.json` exists**

If not, scaffold it (from the Nest defaults):

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

- [x] **Step 2: Write the test**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

describe('Auth + tenant isolation (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);

    // Seed: tenant 'acme' + user
    await ds.query(`
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ('acme', 'Acme', 'tenant_acme', 'active')
      ON CONFLICT (slug) DO NOTHING
    `);
    const hash = await argon2.hash('correctpassword');
    await ds.query(`
      INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
      VALUES ('acme', 'user@acme.test', $1, 'admin', 'active')
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [hash]);
  });

  afterAll(async () => { await app.close(); });

  it('rejects /auth/me without token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('logs in and returns a token usable on /auth/me', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@acme.test', password: 'correctpassword', tenantSlug: 'acme' })
      .expect(200);
    expect(login.body.accessToken).toBeDefined();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.tenantId).toBe('acme');
    expect(me.body.role).toBe('admin');
  });

  it('rejects login with wrong tenant', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@acme.test', password: 'correctpassword', tenantSlug: 'other' })
      .expect(401);
  });
});
```

- [x] **Step 3: Add e2e script**

In `package.json` `scripts`: `"test:e2e": "jest --config test/jest-e2e.json"`

- [x] **Step 4: Run**

```bash
docker compose up -d postgres
npm run migration:run:app
npm run tenant:create acme || true
npm run test:e2e -- --testNamePattern='Auth'
```

Expected: 3 tests pass.

- [x] **Step 5: Commit**

```bash
git add test/auth-tenant.e2e-spec.ts test/jest-e2e.json package.json
git commit -m "test(auth): e2e — login, /me, tenant rejection"
```

---

## Exit Criteria

- [x] `POST /auth/login` returns `{ accessToken, refreshToken, expiresIn }` for valid credentials.
- [x] Unauthenticated calls to non-`@Public()` endpoints return 401.
- [x] `GET /auth/me` returns `{ sub, tenantId, role }` matching the token.
- [x] `SearchPathInterceptor` wraps every request in a transaction with `SET LOCAL search_path = <schema>, shared_catalog, public`.
- [x] `TenantTransactionService.runWithTenant()` is the worker-side equivalent (used by plans 04–06).
- [x] Suspended tenants can never log in.
- [x] `@Roles('admin')` blocks `viewer`/`operator` callers (verified by RolesGuard in unit test of an `@Roles`-protected endpoint, exercised in plan 06).
- [x] Schema names are validated against `^[a-z_][a-z0-9_]{0,62}$` before being interpolated into SQL.
