import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequireModule } from '../../auth/decorators/require-module.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { CreateOfferBookRuleDto } from './dto/create-offer-book-rule.dto';
import {
  PaginatedPreviewResult,
  PreviewOfferBookRulesDto,
} from './dto/preview-offer-book-rules.dto';
import {
  OfferBookRuleDetail,
  OfferBookRulesService,
  PaginatedOfferBookRules,
} from './offer-book-rules.service';

@Controller('offer-book-rules')
@RequireModule(ModuleCode.OFFER_BOOK_RULES)
export class OfferBookRulesController {
  constructor(private readonly rules: OfferBookRulesService) {}

  /**
   * Computes the price each selected product would get under the given rules
   * + locks (+ optional rounding), without persisting anything. The planning
   * step before a rule is saved/executed.
   */
  @Post('preview')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public preview(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PreviewOfferBookRulesDto,
  ): Promise<PaginatedPreviewResult> {
    return this.rules.preview(em, user.tenantId, dto);
  }

  /** Salva o conjunto de regras aplicado a um caderno de ofertas existente. */
  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public create(
    @TenantEm() em: EntityManager,
    @Body() dto: CreateOfferBookRuleDto,
  ): Promise<{ id: string }> {
    return this.rules.create(em, dto);
  }

  @Get()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public list(
    @TenantEm() em: EntityManager,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ): Promise<PaginatedOfferBookRules> {
    return this.rules.list(em, page, pageSize);
  }

  @Get(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public getOne(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OfferBookRuleDetail> {
    return this.rules.getOne(em, id);
  }

  @Delete(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public remove(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.rules.remove(em, id);
  }
}
