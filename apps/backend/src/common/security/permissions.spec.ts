import { MembershipRole } from '@businessbrain/database';
import {
  allPermissions,
  can,
  defaultPermissionsFor,
  isKnownPermission,
  permission,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  PERMISSION_PRESETS,
  type Permission,
} from './permissions';

/**
 * Quién puede qué dentro de una empresa.
 *
 * Es la regla que decide si alguien ve la facturación de su empresa, así que se comprueba
 * sola, sin base de datos delante. Lo que se defiende aquí:
 *
 * 1. El rol es el TECHO: conceder algo por encima no lo otorga.
 * 2. Sin concesiones, cada cual puede lo que podía ANTES de que esto existiera.
 * 3. Al propietario no se le puede recortar.
 */
describe('can', () => {
  const sinConcesiones = (role: MembershipRole) => ({ role, granted: null });

  describe('el rol es el techo', () => {
    /**
     * La prueba que impide que los permisos sean una puerta trasera: si una concesión
     * pudiera dar más de lo que el rol permite, asignar un perfil sería una forma de
     * ascender a alguien sin que nadie lo decidiera.
     */
    it('conceder ESCRITURA a un VIEWER no se la da', () => {
      const concedido: Permission[] = [permission('KNOWLEDGE', 'WRITE')];

      expect(
        can(
          { role: MembershipRole.VIEWER, granted: concedido },
          'KNOWLEDGE',
          'WRITE',
        ),
      ).toBe(false);
    });

    it('conceder la gestión de PERSONAS a un MEMBER no se la da', () => {
      const concedido: Permission[] = [permission('MEMBERS', 'WRITE')];

      expect(
        can(
          { role: MembershipRole.MEMBER, granted: concedido },
          'MEMBERS',
          'WRITE',
        ),
      ).toBe(false);
    });

    it('pero un ADMIN sí puede recibir lo que su rol permite', () => {
      expect(
        can(
          {
            role: MembershipRole.ADMIN,
            granted: [permission('MEMBERS', 'WRITE')],
          },
          'MEMBERS',
          'WRITE',
        ),
      ).toBe(true);
    });
  });

  describe('sin concesiones, todo sigue como estaba', () => {
    it('un VIEWER lee el conocimiento y no lo escribe', () => {
      const viewer = sinConcesiones(MembershipRole.VIEWER);

      expect(can(viewer, 'KNOWLEDGE', 'READ')).toBe(true);
      expect(can(viewer, 'KNOWLEDGE', 'WRITE')).toBe(false);
    });

    it('un VIEWER no ve la configuración ni las personas', () => {
      const viewer = sinConcesiones(MembershipRole.VIEWER);

      expect(can(viewer, 'SETTINGS', 'READ')).toBe(false);
      expect(can(viewer, 'MEMBERS', 'READ')).toBe(false);
    });

    it('un MEMBER escribe conocimiento y decide sobre recomendaciones', () => {
      const member = sinConcesiones(MembershipRole.MEMBER);

      expect(can(member, 'KNOWLEDGE', 'WRITE')).toBe(true);
      expect(can(member, 'RECOMMENDATIONS', 'APPROVE')).toBe(true);
      // Pero no administra la empresa.
      expect(can(member, 'SETTINGS', 'WRITE')).toBe(false);
      expect(can(member, 'INTEGRATIONS', 'WRITE')).toBe(false);
    });

    it('un ADMIN administra la empresa', () => {
      const admin = sinConcesiones(MembershipRole.ADMIN);

      expect(can(admin, 'INTEGRATIONS', 'WRITE')).toBe(true);
      expect(can(admin, 'MEMBERS', 'WRITE')).toBe(true);
    });
  });

  describe('la concesión afina hacia abajo', () => {
    it('un MEMBER con solo lectura de conocimiento deja de poder escribir', () => {
      const soloLectura: Permission[] = [permission('KNOWLEDGE', 'READ')];
      const actor = { role: MembershipRole.MEMBER, granted: soloLectura };

      expect(can(actor, 'KNOWLEDGE', 'READ')).toBe(true);
      expect(can(actor, 'KNOWLEDGE', 'WRITE')).toBe(false);
      // Y pierde lo que su rol le daba en los demás módulos.
      expect(can(actor, 'REPORTS', 'READ')).toBe(false);
    });

    /**
     * Una lista vacía NO es lo mismo que no tener lista: sin concesiones se aplica el valor
     * por defecto del rol; con una lista vacía, la persona no puede nada. Confundirlos
     * convertiría «le he quitado todo» en «lo tiene todo».
     */
    it('una lista VACÍA no es lo mismo que no tener lista', () => {
      const conLista = { role: MembershipRole.MEMBER, granted: [] };
      const sinLista = sinConcesiones(MembershipRole.MEMBER);

      expect(can(conLista, 'KNOWLEDGE', 'READ')).toBe(false);
      expect(can(sinLista, 'KNOWLEDGE', 'READ')).toBe(true);
    });
  });

  describe('al propietario no se le recorta', () => {
    it('lo puede todo aunque su lista esté vacía', () => {
      const owner = { role: MembershipRole.OWNER, granted: [] as Permission[] };

      for (const module of PERMISSION_MODULES) {
        for (const action of PERMISSION_ACTIONS) {
          expect(can(owner, module, action)).toBe(true);
        }
      }
    });
  });

  describe('las acciones no se implican entre sí', () => {
    /**
     * Definir una automatización no es lanzarla, y editar una recomendación no es aceptarla
     * —que compromete a la empresa—. Si `WRITE` implicara `EXECUTE` o `APPROVE`, conceder
     * edición daría por error la capacidad de comprometer.
     */
    it('escribir no implica ejecutar ni aprobar', () => {
      const actor = {
        role: MembershipRole.MEMBER,
        granted: [permission('AUTOMATIONS', 'WRITE')] as Permission[],
      };

      expect(can(actor, 'AUTOMATIONS', 'EXECUTE')).toBe(false);
    });
  });
});

describe('el catálogo', () => {
  it('un propietario tiene exactamente módulos × acciones', () => {
    expect(allPermissions()).toHaveLength(
      PERMISSION_MODULES.length * PERMISSION_ACTIONS.length,
    );
  });

  it.each(['KNOWLEDGE:LEER', 'FACTURACION:READ', 'KNOWLEDGE', '', 'a:b:c'])(
    'un permiso inventado (%s) no se reconoce',
    (valor) => {
      expect(isKnownPermission(valor)).toBe(false);
    },
  );

  it('reconoce los que sí existen', () => {
    for (const p of allPermissions()) expect(isKnownPermission(p)).toBe(true);
  });

  it('todo rol declara su valor por defecto', () => {
    // Si mañana se añade un rol al enum y nadie lo traduce, aquí se ve: sin esta prueba,
    // un rol nuevo caería silenciosamente en "no puede nada" o rompería en ejecución.
    for (const role of Object.values(MembershipRole)) {
      expect(defaultPermissionsFor(role).length).toBeGreaterThan(0);
    }
  });
});

describe('los perfiles', () => {
  it('solo conceden permisos que existen', () => {
    for (const [nombre, permisos] of Object.entries(PERMISSION_PRESETS)) {
      for (const p of permisos) {
        expect(isKnownPermission(p)).toBe(true);
        expect(nombre).toBeTruthy();
      }
    }
  });

  /** Un perfil que concediera algo que su rol no permite sería una promesa incumplible. */
  it('ninguno concede nada que un MEMBER no pueda tener', () => {
    const techoDeMember = defaultPermissionsFor(MembershipRole.MEMBER);

    for (const [nombre, permisos] of Object.entries(PERMISSION_PRESETS)) {
      const imposibles = permisos.filter((p) => !techoDeMember.includes(p));
      expect({ nombre, imposibles }).toEqual({ nombre, imposibles: [] });
    }
  });

  it('ninguno da acceso a personas ni a configuración', () => {
    // Son las dos llaves de la empresa: se conceden subiendo de rol, no con un perfil.
    for (const permisos of Object.values(PERMISSION_PRESETS)) {
      expect(permisos.some((p) => p.startsWith('MEMBERS:'))).toBe(false);
      expect(permisos.some((p) => p.startsWith('SETTINGS:'))).toBe(false);
    }
  });

  it('atención al cliente no ve análisis ni informes', () => {
    const perfil = PERMISSION_PRESETS.ATENCION_CLIENTE;

    expect(perfil).not.toContain(permission('ANALYSIS', 'READ'));
    expect(perfil).not.toContain(permission('REPORTS', 'READ'));
  });
});
