import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './jwt-payload.type';
import { ModuleCode } from '../database/enums/module-code.enum';
import { TenantService } from '../tenant/tenant.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tenants: TenantService,
  ) {}

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
  public async me(
    @CurrentUser() user: JwtPayload,
  ): Promise<JwtPayload & { modules: ModuleCode[] }> {
    // O FE usa `modules` para exibir só os módulos liberados; system admin
    // ('system' é slug reservado) enxerga tudo.
    if (user.tenantId === 'system')
      return { ...user, modules: Object.values(ModuleCode) };
    try {
      const { modules } = await this.tenants.findBySlug(user.tenantId);
      return { ...user, modules };
    } catch (e) {
      // Tenant offboardado (soft-delete) com token ainda válido: 401
      // derruba a sessão no FE em vez de vazar um 404.
      if (e instanceof NotFoundException) throw new UnauthorizedException();
      throw e;
    }
  }
}
