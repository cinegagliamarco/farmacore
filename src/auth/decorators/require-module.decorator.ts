import { CustomDecorator, SetMetadata } from '@nestjs/common';
import type { ModuleCode } from '../../database/enums/module-code.enum';

export const REQUIRED_MODULES_KEY = 'requiredModules';

/**
 * Libera a rota quando o tenant tem PELO MENOS UM dos módulos habilitados
 * (rotas compartilhadas por dois módulos listam ambos).
 */
export const RequireModule = (
  ...modules: ModuleCode[]
): CustomDecorator<string> => SetMetadata(REQUIRED_MODULES_KEY, modules);
