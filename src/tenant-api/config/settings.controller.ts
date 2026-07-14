import { Body, Controller, Get, Patch } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { OfferDefaultsDto, VariationStatusDto } from './dto/config.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('variation-status')
  public get(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<Record<string, number>> {
    return this.settings.getVariationStatus(em, user.tenantId);
  }

  @Patch('variation-status')
  @Roles(UserRole.ADMIN)
  public patch(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: VariationStatusDto,
  ): Promise<Record<string, number>> {
    return this.settings.updateVariationStatus(em, user.tenantId, dto);
  }

  @Get('offer-defaults')
  public getOfferDefaults(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ defaultCadernoId: number | null }> {
    return this.settings.getOfferDefaults(em, user.tenantId);
  }

  @Patch('offer-defaults')
  @Roles(UserRole.ADMIN)
  public patchOfferDefaults(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: OfferDefaultsDto,
  ): Promise<{ defaultCadernoId: number | null }> {
    return this.settings.updateOfferDefaults(
      em,
      user.tenantId,
      dto.defaultCadernoId,
    );
  }
}
