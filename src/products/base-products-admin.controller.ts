import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SystemAdminGuard } from '../admin/guards/system-admin.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/enums/user-role.enum';
import { BaseProductsAdminService } from './base-products-admin.service';
import {
  ListBaseProductsQueryDto,
  RenameActiveIngredientDto,
  UpdateBaseProductDto,
} from './dto/base-products-admin.dto';

/**
 * Cadastro interno (shared_catalog.base_product): edita os campos
 * curados por EAN (princípio ativo, generic, descrição, peso e medidas).
 * System-admin only — o dado é global, compartilhado por todos os tenants.
 */
@Controller('admin/catalog/base-products')
@UseGuards(SystemAdminGuard)
@Roles(UserRole.ADMIN)
export class BaseProductsAdminController {
  constructor(private readonly service: BaseProductsAdminService) {}

  @Get()
  public list(
    @Query() query: ListBaseProductsQueryDto,
  ): ReturnType<BaseProductsAdminService['list']> {
    return this.service.list(query);
  }

  /** Nomes distintos + nº de EANs — autocomplete e visão de nomenclatura. */
  @Get('active-ingredients')
  public activeIngredients(): Promise<Array<{ name: string; eans: number }>> {
    return this.service.activeIngredients();
  }

  /** Renomeia um princípio ativo em todos os EANs que o usam. */
  @Post('active-ingredients/rename')
  public rename(
    @Body() dto: RenameActiveIngredientDto,
  ): Promise<{ from: string; to: string; updated: number }> {
    return this.service.rename(dto.from, dto.to);
  }

  @Patch(':ean')
  public update(
    @Param('ean') ean: string,
    @Body() dto: UpdateBaseProductDto,
  ): Promise<{ ean: string; updated: number }> {
    // ≤14 dígitos (GTIN-14): acima disso estoura o bigint e viraria 500.
    if (!/^\d{1,14}$/.test(ean)) {
      throw new BadRequestException('ean must be numeric (up to 14 digits)');
    }
    return this.service.update(ean, dto);
  }
}
