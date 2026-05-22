import { IsIn } from 'class-validator';
import { TenantStatus } from '../../database/enums/tenant-status.enum';

export class UpdateTenantStatusDto {
  @IsIn(Object.values(TenantStatus))
  status!: TenantStatus;
}
