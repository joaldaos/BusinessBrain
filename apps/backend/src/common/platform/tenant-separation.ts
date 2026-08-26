import { PlatformRole } from '@businessbrain/database';

/**
 * La frontera entre quien opera BusinessBrain y quien lo usa.
 *
 * ## La invariante
 *
 * **Una cuenta de plataforma no puede pertenecer a ninguna organización, y una cuenta que
 * pertenece a alguna no puede ser de plataforma.** No es una preferencia de organización del
 * código: es lo que hace que la separación sea verificable en vez de una intención.
 *
 * ## Por qué así y no con un segundo sistema de cuentas
 *
 * Separar las tablas obligaría a duplicar autenticación, recuperación de contraseña, sesiones
 * e invitaciones — cuatro superficies de seguridad ya construidas y probadas, mantenidas dos
 * veces. Y no compraría nada que esta invariante no compre: mientras el administrador no tenga
 * membresías, `OrgRoleGuard` le responde 403 en toda la API de tenant **por el camino normal**,
 * sin excepciones que alguien pueda olvidar.
 *
 * Eso es lo importante: el aislamiento no depende de que nadie escriba un `if` correcto. Un
 * administrador de plataforma es, para la API de cliente, exactamente igual que un desconocido.
 *
 * ## Y por qué se comprueba al CREAR la membresía
 *
 * Porque es el único momento en que se puede impedir. Comprobarlo al leer sería tarde: para
 * entonces la membresía ya existe, y basta con que una ruta se olvide de mirar.
 */

/** ¿Puede esta cuenta pertenecer a una organización de cliente? */
export function canHoldMembership(platformRole: PlatformRole): boolean {
  return platformRole !== PlatformRole.SUPERADMIN;
}

/** ¿Puede esta cuenta recibir el rol de plataforma? */
export function canBecomePlatformAdmin(membershipCount: number): boolean {
  return membershipCount === 0;
}

/**
 * El mensaje cuando se intenta cruzar la frontera.
 *
 * Explica la razón, no la regla: quien lo lee tiene que entender por qué el producto se niega,
 * no solo que se niega.
 */
export const MEMBERSHIP_DENIED_TO_PLATFORM_ADMIN =
  'Una cuenta de administración de BusinessBrain no puede pertenecer a una empresa cliente. ' +
  'Usa una cuenta distinta para trabajar dentro de una organización.';

export const PLATFORM_ROLE_DENIED_TO_MEMBER =
  'Esta cuenta pertenece a una o más empresas cliente y no puede convertirse en cuenta de ' +
  'administración de BusinessBrain.';
