import { Body, Controller, Post } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequireModule } from '../../auth/decorators/require-module.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  PaginatedPreviewResult,
  PreviewOfferBookRulesDto,
} from './dto/preview-offer-book-rules.dto';
import { OfferBookRulesService } from './offer-book-rules.service';

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
}
