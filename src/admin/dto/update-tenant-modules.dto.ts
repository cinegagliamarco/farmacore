import { ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { ModuleCode } from '../../database/enums/module-code.enum';

export class UpdateTenantModulesDto {
  @IsArray()
  @ArrayUnique()
  @IsEnum(ModuleCode, { each: true })
  modules!: ModuleCode[];
}
