import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { AuditService } from './audit.service';
import { UpsertSuggestionRuleDto } from './dto/suggestion-rule.dto';
import {
  SuggestionRuleApi,
  SuggestionRulesService,
} from './suggestion-rules.service';

/**
 * Regras de sugestão de preços do tenant. Leitura e mutação exigem operator/admin
 * (custo/margem/composição são sensíveis). Escopo de tenant pelo
 * SearchPathInterceptor global. Mutações registram trilha de auditoria.
 */
@Controller('pricing/suggestion-rules')
export class SuggestionRulesController {
  constructor(
    private readonly rules: SuggestionRulesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public list(@TenantEm() em: EntityManager): Promise<SuggestionRuleApi[]> {
    return this.rules.list(em);
  }

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public async create(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertSuggestionRuleDto,
  ): Promise<SuggestionRuleApi> {
    const rule = await this.rules.create(em, user.tenantId, dto);
    await this.audit.log(em, {
      actor: user.sub,
      action: 'create',
      entity: 'suggestion_rule',
      entityId: rule.id,
      changes: dto,
    });
    return rule;
  }

  @Patch(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public async update(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertSuggestionRuleDto,
  ): Promise<SuggestionRuleApi> {
    const rule = await this.rules.update(em, user.tenantId, id, dto);
    await this.audit.log(em, {
      actor: user.sub,
      action: 'update',
      entity: 'suggestion_rule',
      entityId: id,
      changes: dto,
    });
    return rule;
  }

  @Delete(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public async remove(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    const res = await this.rules.remove(em, id);
    await this.audit.log(em, {
      actor: user.sub,
      action: 'delete',
      entity: 'suggestion_rule',
      entityId: id,
    });
    return res;
  }
}
