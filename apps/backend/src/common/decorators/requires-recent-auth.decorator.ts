import { SetMetadata } from '@nestjs/common';
import type { SensitiveAction } from '../security/sensitive-actions';

export const RECENT_AUTH_KEY = 'recentAuthAction';

/**
 * Marca una ruta como acción sensible: exige credencial reciente en ESTA sesión.
 *
 * Lleva la acción y no solo un booleano porque la denegación se audita, y "se denegó algo" no
 * sirve de nada comparado con "se intentó borrar los datos de la empresa sin reautenticarse".
 *
 * Va siempre acompañado de `@UseGuards(RecentAuthGuard)`. Podría ser global y no lo es, por la
 * misma razón que `OrgRoleGuard` tampoco lo es: un guard global obliga a acordarse de EXCLUIR
 * cada ruta que no lo necesita, y el día que a alguien se le olvide, una ruta normal empieza a
 * pedir contraseñas sin que nadie entienda por qué. Aquí la lista de rutas sensibles es corta y
 * se lee entera.
 */
export const RequiresRecentAuth = (action: SensitiveAction) =>
  SetMetadata(RECENT_AUTH_KEY, action);
