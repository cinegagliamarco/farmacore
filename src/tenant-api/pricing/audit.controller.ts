import { Controller, Get, Query } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { AuditService, AuditView } from './audit.service';

/**
 * Trilha de auditoria do tenant (somente leitura, admin). Filtra por
 * entity/entityId e pagina. Append-only — não há rota de escrita aqui;
 * o registro acontece junto da mutação que o gerou.
 */
@Controller('pricing/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  public list(
    @TenantEm() em: EntityManager,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AuditView[]> {
    return this.audit.list(
      em,
      { entity, entityId },
      page ? Number(page) : undefined,
      perPage ? Number(perPage) : undefined,
    );
  }
}
