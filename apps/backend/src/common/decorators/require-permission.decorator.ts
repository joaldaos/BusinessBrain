import { SetMetadata } from '@nestjs/common';
import type {
  PermissionAction,
  PermissionModule,
} from '../security/permissions';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

export interface RequiredPermission {
  module: PermissionModule;
  action: PermissionAction;
}

/**
 * Declara qué permiso exige esta ruta.
 *
 * Los tipos vienen del catálogo, así que un módulo o una acción que no existan **no
 * compilan**. Es lo que impide que una ruta quede protegida por una cadena mal escrita que
 * nadie concede nunca —y que por tanto nadie puede usar— o, peor, por una que no se
 * comprueba.
 */
export const RequirePermission = (
  module: PermissionModule,
  action: PermissionAction,
) => SetMetadata(REQUIRED_PERMISSION_KEY, { module, action });
