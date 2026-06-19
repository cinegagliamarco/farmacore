import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  CreatePriceRoundingRuleDto,
  UpdatePriceRoundingRuleDto,
} from './dto/config.dto';
import { PriceRoundingService } from './price-rounding.service';

@Controller('configurations/price-rounding')
export class PriceRoundingController {
  constructor(private readonly rules: PriceRoundingService) {}

  @Get()
  public list(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<unknown[]> {
    return this.rules.list(em, user.tenantId);
  }

  @Get(':id')
  public get(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.rules.get(em, user.tenantId, id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  public create(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePriceRoundingRuleDto,
  ): Promise<unknown> {
    return this.rules.create(em, user.tenantId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  public update(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePriceRoundingRuleDto,
  ): Promise<unknown> {
    return this.rules.update(em, user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  public remove(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    return this.rules.remove(em, user.tenantId, id);
  }
}
