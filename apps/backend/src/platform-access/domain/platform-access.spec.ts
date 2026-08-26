import {
  PlatformAccessScope,
  PlatformAccessStatus,
} from '@businessbrain/database';
import {
  DENIAL_MESSAGES,
  PENDING_APPROVAL_HOURS,
  SCOPE_POLICIES,
  evaluateGrant,
  pendingApprovalExpiry,
  requiresOwnerApproval,
  resolveExpiry,
  type GrantSnapshot,
} from './platform-access';

describe('acceso administrativo a los datos de una empresa', () => {
  const AHORA = new Date('2026-08-26T10:00:00.000Z');
  const ADMIN = 'admin-1';

  const concesion = (
    overrides: Partial<GrantSnapshot> = {},
  ): GrantSnapshot => ({
    scope: PlatformAccessScope.METADATA,
    status: PlatformAccessStatus.ACTIVE,
    requestedById: ADMIN,
    expiresAt: new Date(AHORA.getTime() + 3600_000),
    revokedAt: null,
    ...overrides,
  });

  const pedir = (
    scope: PlatformAccessScope,
    grant: GrantSnapshot | null,
    adminId = ADMIN,
  ) => evaluateGrant(grant, { scope, adminId, now: AHORA });

  describe('los alcances son independientes', () => {
    it('CRÍTICO: METADATA no abre DIAGNOSTICS ni CONTENT', () => {
      const soloMetadatos = concesion({ scope: PlatformAccessScope.METADATA });

      expect(pedir(PlatformAccessScope.DIAGNOSTICS, soloMetadatos)).toEqual({
        allowed: false,
        reason: 'OTHER_SCOPE',
      });
      expect(pedir(PlatformAccessScope.CONTENT, soloMetadatos)).toEqual({
        allowed: false,
        reason: 'OTHER_SCOPE',
      });
    });

    it('CRÍTICO: DIAGNOSTICS no abre METADATA ni CONTENT', () => {
      const diagnostico = concesion({ scope: PlatformAccessScope.DIAGNOSTICS });

      expect(pedir(PlatformAccessScope.CONTENT, diagnostico).allowed).toBe(
        false,
      );
      expect(pedir(PlatformAccessScope.METADATA, diagnostico).allowed).toBe(
        false,
      );
    });

    it('CRÍTICO: CONTENT tampoco arrastra los otros dos', () => {
      // Una jerarquía habría sido más cómoda y habría convertido cada aprobación de contenido
      // en una concesión de más cosas de las que el propietario creía estar aprobando.
      const contenido = concesion({ scope: PlatformAccessScope.CONTENT });

      expect(pedir(PlatformAccessScope.METADATA, contenido).allowed).toBe(
        false,
      );
      expect(pedir(PlatformAccessScope.DIAGNOSTICS, contenido).allowed).toBe(
        false,
      );
    });

    it('cada alcance sí sirve para el suyo', () => {
      for (const scope of Object.values(PlatformAccessScope)) {
        expect(pedir(scope, concesion({ scope })).allowed).toBe(true);
      }
    });
  });

  describe('sin concesión no hay acceso', () => {
    it('CRÍTICO: el rol de plataforma no concede nada por sí solo', () => {
      // Es la regla entera: administrar BusinessBrain no es ser superusuario de los datos de
      // los clientes. Sin una concesión explícita, la respuesta es la misma que para
      // cualquiera.
      for (const scope of Object.values(PlatformAccessScope)) {
        expect(pedir(scope, null)).toEqual({
          allowed: false,
          reason: 'NO_GRANT',
        });
      }
    });

    it('CRÍTICO: la concesión es de quien la pidió, no de cualquier administrador', () => {
      // Lo que impide que otra identidad —humana o no— reutilice un acceso ajeno.
      expect(
        pedir(PlatformAccessScope.METADATA, concesion(), 'otro-admin'),
      ).toEqual({ allowed: false, reason: 'OTHER_ADMIN' });
    });
  });

  describe('caducidad y revocación', () => {
    it('CRÍTICO: una concesión caducada deniega en el instante siguiente', () => {
      const justoCaducada = concesion({ expiresAt: AHORA });

      expect(pedir(PlatformAccessScope.METADATA, justoCaducada)).toEqual({
        allowed: false,
        reason: 'EXPIRED',
      });
    });

    it('CRÍTICO: una concesión revocada deniega aunque no haya caducado', () => {
      const retirada = concesion({
        status: PlatformAccessStatus.REVOKED,
        revokedAt: new Date(AHORA.getTime() - 1000),
        expiresAt: new Date(AHORA.getTime() + 86_400_000),
      });

      expect(pedir(PlatformAccessScope.METADATA, retirada)).toEqual({
        allowed: false,
        reason: 'REVOKED',
      });
    });

    it('una petición sin aprobar todavía no sirve', () => {
      const pendiente = concesion({
        scope: PlatformAccessScope.CONTENT,
        status: PlatformAccessStatus.PENDING,
      });

      expect(pedir(PlatformAccessScope.CONTENT, pendiente)).toEqual({
        allowed: false,
        reason: 'AWAITING_APPROVAL',
      });
    });
  });

  describe('cuánto dura', () => {
    it('CRÍTICO: nunca hay concesiones indefinidas', () => {
      // Ni pidiendo un número absurdo, ni sin pedir nada.
      for (const scope of Object.values(PlatformAccessScope)) {
        const sinPedir = resolveExpiry(scope, undefined, AHORA);
        const pidiendoUnAno = resolveExpiry(scope, 24 * 365, AHORA);
        const techo =
          AHORA.getTime() + SCOPE_POLICIES[scope].maxHours * 3600_000;

        expect(sinPedir.getTime()).toBeGreaterThan(AHORA.getTime());
        expect(pidiendoUnAno.getTime()).toBeLessThanOrEqual(techo);
      }
    });

    it('se recorta al techo en vez de rechazar', () => {
      // Quien pide siete días de contenido probablemente no sabe que el máximo son tres.
      // Devolverle un error en vez de la concesión más larga posible solo añade una vuelta.
      const recortada = resolveExpiry(
        PlatformAccessScope.CONTENT,
        24 * 7,
        AHORA,
      );

      expect(recortada.getTime()).toBe(AHORA.getTime() + 72 * 3600_000);
    });

    it('un valor absurdo cae al de por defecto', () => {
      for (const absurdo of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const resultado = resolveExpiry(
          PlatformAccessScope.METADATA,
          absurdo,
          AHORA,
        );
        expect(resultado.getTime()).toBeLessThanOrEqual(
          AHORA.getTime() + SCOPE_POLICIES.METADATA.maxHours * 3600_000,
        );
        expect(resultado.getTime()).toBeGreaterThan(AHORA.getTime());
      }
    });

    it('el contenido dura menos que los metadatos', () => {
      // Un acceso a metadatos abierto una semana es una molestia; un acceso al contenido
      // abierto una semana es otra cosa.
      expect(SCOPE_POLICIES.CONTENT.maxHours).toBeLessThan(
        SCOPE_POLICIES.METADATA.maxHours,
      );
    });

    it('una petición sin aprobar caduca sola', () => {
      // Sin este tope podría aprobarse meses después, cuando el motivo ya no existe.
      expect(pendingApprovalExpiry(AHORA).getTime()).toBe(
        AHORA.getTime() + PENDING_APPROVAL_HOURS * 3600_000,
      );
    });
  });

  describe('quién tiene que aprobar', () => {
    it('CRÍTICO: solo el contenido exige aprobación del propietario', () => {
      expect(requiresOwnerApproval(PlatformAccessScope.CONTENT)).toBe(true);
      expect(requiresOwnerApproval(PlatformAccessScope.METADATA)).toBe(false);
      expect(requiresOwnerApproval(PlatformAccessScope.DIAGNOSTICS)).toBe(
        false,
      );
    });
  });

  describe('lo que se le dice a quien recibe la denegación', () => {
    it('CRÍTICO: no revela si existe un acceso de otro alcance o de otra persona', () => {
      // Quien pregunta por un acceso que no tiene no debería poder deducir el mapa de accesos
      // ajenos a base de probar combinaciones.
      expect(DENIAL_MESSAGES.OTHER_SCOPE).toBe(DENIAL_MESSAGES.NO_GRANT);
      expect(DENIAL_MESSAGES.OTHER_ADMIN).toBe(DENIAL_MESSAGES.NO_GRANT);
    });

    it('dice qué hacer, sin jerga', () => {
      for (const mensaje of Object.values(DENIAL_MESSAGES)) {
        expect(mensaje.length).toBeGreaterThan(20);
        expect(mensaje).not.toMatch(
          /GRANT|SCOPE|PENDING|REVOKED|EXPIRED|Guard|null/,
        );
      }
    });
  });
});
