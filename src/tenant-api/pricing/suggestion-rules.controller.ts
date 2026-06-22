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
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { UpsertSuggestionRuleDto } from './dto/suggestion-rule.dto';
import {
  SuggestionRuleApi,
  SuggestionRulesService,
} from './suggestion-rules.service';

/**
 * Regras de sugestão de preços do tenant. Leitura aberta; mutações exigem
 * operator/admin. Escopo de tenant pelo SearchPathInterceptor global.
 */
@Controller('pricing/suggestion-rules')
export class SuggestionRulesController {
  constructor(private readonly rules: SuggestionRulesService) {}

  @Get()
  public list(@TenantEm() em: EntityManager): Promise<SuggestionRuleApi[]> {
    return this.rules.list(em);
  }

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public create(
    @TenantEm() em: EntityManager,
    @Body() dto: UpsertSuggestionRuleDto,
  ): Promise<SuggestionRuleApi> {
    return this.rules.create(em, dto);
  }

  @Patch(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public update(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertSuggestionRuleDto,
  ): Promise<SuggestionRuleApi> {
    return this.rules.update(em, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public remove(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    return this.rules.remove(em, id);
  }
}
