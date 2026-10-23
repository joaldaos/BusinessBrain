import { MembershipRole } from '@businessbrain/database';

/**
 * Qué puede hacer cada persona dentro de su empresa.
 *
 * ## Por qué hacía falta algo más que el rol
 *
 * Hasta aquí el rol era global dentro de la empresa: un `MEMBER` lo era para todo. Eso vale
 * mientras el producto entiende documentos, pero deja de valer en cuanto entiende ventas y
 * cobros: quien lleva atención al cliente no tiene por qué ver la facturación, y quien lleva
 * la contabilidad no tiene por qué tocar las automatizaciones.
 *
 * ## El modelo: un techo y una concesión
 *
 * - **El rol es el techo.** Un `VIEWER` no puede escribir aunque alguien le conceda escritura:
 *   la concesión afina hacia abajo, nunca hacia arriba. Sin esta regla, conceder un permiso
 *   suelto sería una vía para saltarse el rol.
 * - **La concesión es lo que de verdad tiene.** Si no hay ninguna, se usa la que le
 *   corresponde a su rol — y por eso **nada cambia el primer día**: una empresa que nunca
 *   toque esto se comporta exactamente como antes.
 * - **El propietario lo puede todo, siempre.** No se le puede recortar. Una empresa que se
 *   quedara sin nadie capaz de gestionar permisos estaría bloqueada para siempre.
 *
 * ## Por qué los módulos son un catálogo cerrado
 *
 * Igual que el resto del sistema: lo que se puede conceder tiene que ser una lista explícita
 * y revisable. Un permiso con nombre libre acabaría siendo una cadena escrita a mano en una
 * pantalla, y nadie podría responder «¿quién puede ver la facturación?».
 */

/** Las áreas del producto sobre las que se concede algo. */
export const PERMISSION_MODULES = [
  /** Documentos, fuentes y colecciones. */
  'KNOWLEDGE',
  /** Preguntar y conversaciones. */
  'ASSISTANT',
  /** Comprensión: conclusiones y análisis. */
  'ANALYSIS',
  /** Objetivos empresariales. */
  'OBJECTIVES',
  /** Recomendaciones: verlas y decidir sobre ellas. */
  'RECOMMENDATIONS',
  /** Automatizaciones. */
  'AUTOMATIONS',
  /** Informes. */
  'REPORTS',
  /** Conexiones con sistemas externos. */
  'INTEGRATIONS',
  /** Personas, invitaciones y permisos. */
  'MEMBERS',
  /** Configuración de la empresa, incluida la clave de IA. */
  'SETTINGS',
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

/**
 * Qué se puede hacer sobre un módulo.
 *
 * Cuatro y no más. `EXECUTE` y `APPROVE` existen separados de `WRITE` porque son decisiones
 * distintas: definir una automatización no es lo mismo que lanzarla, y aceptar una
 * recomendación —que compromete a la empresa— no es lo mismo que editarla.
 */
export const PERMISSION_ACTIONS = [
  'READ',
  'WRITE',
  'EXECUTE',
  'APPROVE',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Un permiso concreto, en el formato en que se compara y se guarda. */
export type Permission = `${PermissionModule}:${PermissionAction}`;

export function permission(
  module: PermissionModule,
  action: PermissionAction,
): Permission {
  return `${module}:${action}`;
}

/** Todo lo que existe. Es lo que tiene el propietario. */
export function allPermissions(): Permission[] {
  return PERMISSION_MODULES.flatMap((module) =>
    PERMISSION_ACTIONS.map((action) => permission(module, action)),
  );
}

/**
 * Lo que puede hacer un rol SIN que nadie le conceda nada.
 *
 * Es la traducción fiel de lo que cada rol ya podía hacer antes de que existieran los
 * permisos. No es una propuesta de cómo deberían ser las cosas: es lo que son, escrito de
 * otra forma, para que introducir el sistema no cambie el comportamiento de ninguna empresa.
 */
export function defaultPermissionsFor(role: MembershipRole): Permission[] {
  switch (role) {
    case MembershipRole.OWNER:
      return allPermissions();

    case MembershipRole.ADMIN:
      // Todo salvo nada: hoy un ADMIN administra la empresa entera. Lo único que no puede es
      // lo que el producto reserva explícitamente al propietario, y eso lo sigue decidiendo
      // `@OrgRoles(OWNER)` en la ruta, no este catálogo.
      return allPermissions();

    case MembershipRole.MEMBER:
      return [
        ...leerTodo(),
        permission('KNOWLEDGE', 'WRITE'),
        permission('ASSISTANT', 'WRITE'),
        permission('ANALYSIS', 'EXECUTE'),
        permission('OBJECTIVES', 'WRITE'),
        permission('RECOMMENDATIONS', 'APPROVE'),
        permission('AUTOMATIONS', 'EXECUTE'),
        permission('REPORTS', 'EXECUTE'),
      ];

    case MembershipRole.VIEWER:
      return leerTodo();
  }
}

/** Leer, en todos los módulos salvo los que gobiernan la propia empresa. */
function leerTodo(): Permission[] {
  return PERMISSION_MODULES.filter(
    (module) => module !== 'MEMBERS' && module !== 'SETTINGS',
  ).map((module) => permission(module, 'READ'));
}

/**
 * ¿Puede esta persona hacer esto?
 *
 * Función pura y sin base de datos delante: la regla de quién puede qué tiene que poder
 * comprobarse sola, porque es la que decide si alguien ve la facturación de su empresa.
 *
 * @param granted concesiones explícitas, o `null` si no tiene ninguna — que NO es lo mismo
 *   que tener una lista vacía: sin concesiones se aplica el valor por defecto de su rol;
 *   con una lista vacía, no puede nada.
 */
export function can(
  params: {
    role: MembershipRole;
    granted: Permission[] | null;
  },
  module: PermissionModule,
  action: PermissionAction,
): boolean {
  // El propietario no se puede recortar. Una empresa sin nadie capaz de gestionar permisos
  // quedaría bloqueada sin vuelta atrás.
  if (params.role === MembershipRole.OWNER) return true;

  const requerido = permission(module, action);
  const techo = defaultPermissionsFor(params.role);

  // El rol es el TECHO: conceder algo por encima del rol no lo otorga. Sin esto, una
  // concesión suelta sería una vía para saltarse el rol.
  if (!techo.includes(requerido)) return false;

  const efectivos = params.granted ?? techo;
  return efectivos.includes(requerido);
}

/**
 * Perfiles con los que un propietario asigna permisos sin pensarlos uno a uno.
 *
 * Viven en el código y no en una tabla: una tabla de perfiles se desincroniza del catálogo en
 * cuanto alguien añade un módulo, y además invita a que cada empresa invente los suyos — que
 * es exactamente lo que hace imposible responder «¿quién puede ver la facturación?».
 *
 * Asignar un perfil ESCRIBE sus permisos. A partir de ahí son de la persona y se pueden
 * ajustar uno a uno: el perfil es un punto de partida, no una atadura.
 */
export const PERMISSION_PRESETS = {
  /** Administración: documentos y correo administrativo. */
  ADMINISTRACION: [
    permission('KNOWLEDGE', 'READ'),
    permission('KNOWLEDGE', 'WRITE'),
    permission('ASSISTANT', 'READ'),
    permission('ASSISTANT', 'WRITE'),
    permission('REPORTS', 'READ'),
  ],
  /** Contabilidad y finanzas: lee lo suyo y genera informes, no toca el resto. */
  CONTABILIDAD: [
    permission('KNOWLEDGE', 'READ'),
    permission('ASSISTANT', 'READ'),
    permission('ASSISTANT', 'WRITE'),
    permission('ANALYSIS', 'READ'),
    permission('REPORTS', 'READ'),
    permission('REPORTS', 'EXECUTE'),
  ],
  /** Atención al cliente: pregunta y consulta, no decide ni configura. */
  ATENCION_CLIENTE: [
    permission('KNOWLEDGE', 'READ'),
    permission('ASSISTANT', 'READ'),
    permission('ASSISTANT', 'WRITE'),
  ],
  /** Marketing: consulta y análisis, sin tocar conexiones ni personas. */
  MARKETING: [
    permission('KNOWLEDGE', 'READ'),
    permission('ASSISTANT', 'READ'),
    permission('ASSISTANT', 'WRITE'),
    permission('ANALYSIS', 'READ'),
    permission('OBJECTIVES', 'READ'),
    permission('REPORTS', 'READ'),
  ],
  /** Dirección: lo ve todo y decide, pero no administra personas ni configuración. */
  DIRECCION: [
    ...PERMISSION_MODULES.filter(
      (m) => m !== 'MEMBERS' && m !== 'SETTINGS' && m !== 'INTEGRATIONS',
    ).map((m) => permission(m, 'READ')),
    permission('OBJECTIVES', 'WRITE'),
    permission('RECOMMENDATIONS', 'APPROVE'),
    permission('REPORTS', 'EXECUTE'),
  ],
} satisfies Record<string, Permission[]>;

export type PermissionPreset = keyof typeof PERMISSION_PRESETS;

/** Un permiso escrito a mano que ya no existe en el catálogo no concede nada. */
export function isKnownPermission(value: string): value is Permission {
  const [module, action] = value.split(':');
  return (
    PERMISSION_MODULES.includes(module as PermissionModule) &&
    PERMISSION_ACTIONS.includes(action as PermissionAction)
  );
}
