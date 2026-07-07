import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
import { ListSuggestionsQueryDto } from './dto/list-suggestions.query';
import { UpsertSuggestionRuleDto } from './dto/suggestion-rule.dto';
import {
  PricingSuggestionsService,
  SuggestionsResponse,
} from './pricing-suggestions.service';

/**
 * Sugestão de preços — produtos do tenant com o preço sugerido calculado pelo
 * motor sobre as regras ativas. Tenant-scoped; precisa do slug (origens de
 * concorrente e arredondamento vivem em core, keyed by tenant_id).
 */
@Controller('pricing/suggestions')
@RequireModule(ModuleCode.PRICING_RULES)
export class PricingSuggestionsController {
  constructor(private readonly suggestions: PricingSuggestionsService) {}

  // Operator/admin: a geração carrega o catálogo inteiro e calcula em memória —
  // restringir reduz a superfície de custo (um VIEWER não dispara o full-scan).
  // Cache curto ameniza chamadas repetidas (ex.: paginação).
  @Get()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @Header('Cache-Control', 'private, max-age=30')
  public list(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListSuggestionsQueryDto,
  ): Promise<SuggestionsResponse> {
    return this.suggestions.suggestions(em, user.tenantId, query);
  }

  // Dry-run de uma regra ainda não salva: "o que essa regra faria?".
  @Post('preview')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @HttpCode(200)
  public preview(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertSuggestionRuleDto,
    @Query() query: ListSuggestionsQueryDto,
  ): Promise<SuggestionsResponse> {
    return this.suggestions.preview(em, user.tenantId, dto, query);
  }
}
