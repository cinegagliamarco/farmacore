import { Controller, Get, Query } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { ListSuggestionsQueryDto } from './dto/list-suggestions.query';
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
export class PricingSuggestionsController {
  constructor(private readonly suggestions: PricingSuggestionsService) {}

  @Get()
  public list(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListSuggestionsQueryDto,
  ): Promise<SuggestionsResponse> {
    return this.suggestions.suggestions(em, user.tenantId, query);
  }
}
