import { MembershipRole, PlatformRole } from '@businessbrain/database';
import {
  AFTER_SUCCESSFUL_ATTEMPT,
  MFA_MAX_FAILED_ATTEMPTS,
  REMOVAL_DENIAL_MESSAGES,
  afterFailedAttempt,
  canOwnerRemoveMfa,
  isLockedOut,
  mfaIsMandatory,
  type AttemptState,
} from './mfa-policy';

describe('quién tiene que llevar segundo factor', () => {
  it('CRÍTICO: la administración de plataforma, obligatoriamente', () => {
    // Su cuenta es la que puede pedir acceso a los datos de cualquier cliente. Comprometerla
    // no es un incidente de una empresa: son todas.
    expect(mfaIsMandatory(PlatformRole.SUPERADMIN)).toBe(true);
  });

  it('un cliente no está obligado', () => {
    // Obligarle significaría que el primer día del piloto no puede entrar en su producto
    // hasta instalarse una aplicación en el móvil.
    expect(mfaIsMandatory(PlatformRole.USER)).toBe(false);
  });
});

describe('el propietario retira el segundo factor de alguien de su empresa', () => {
  const PROPIETARIO = 'owner-1';
  const ADMINISTRADOR = 'admin-1';

  const decidir = (
    overrides: Partial<Parameters<typeof canOwnerRemoveMfa>[0]> = {},
  ) =>
    canOwnerRemoveMfa({
      actorRole: MembershipRole.OWNER,
      actorUserId: PROPIETARIO,
      targetUserId: ADMINISTRADOR,
      targetRole: MembershipRole.ADMIN,
      ...overrides,
    });

  it('puede con un administrador de su empresa', () => {
    expect(decidir()).toEqual({ allowed: true });
  });

  it('CRÍTICO: un administrador no puede con otro administrador', () => {
    expect(decidir({ actorRole: MembershipRole.ADMIN })).toEqual({
      allowed: false,
      reason: 'ACTOR_NOT_OWNER',
    });
  });

  it('CRÍTICO: el propietario no puede consigo mismo por esta vía', () => {
    // Si pudiera, su propia sesión abierta sería la forma de quitarse el segundo factor — y
    // el segundo factor dejaría de proteger la sesión desde la que se usa. Para eso está
    // desactivarlo desde su configuración, que exige reautenticarse.
    expect(
      decidir({ targetUserId: PROPIETARIO, targetRole: MembershipRole.OWNER }),
    ).toEqual({ allowed: false, reason: 'TARGET_IS_SELF' });
  });

  it('CRÍTICO: no puede con alguien que no pertenece a su empresa', () => {
    expect(decidir({ targetRole: null })).toEqual({
      allowed: false,
      reason: 'TARGET_NOT_IN_ORGANIZATION',
    });
  });

  it('CRÍTICO: no puede con otro propietario, ni con un miembro raso', () => {
    for (const rol of [
      MembershipRole.OWNER,
      MembershipRole.MEMBER,
      MembershipRole.VIEWER,
    ]) {
      expect(decidir({ targetRole: rol }).allowed).toBe(false);
    }
  });

  it('CRÍTICO: "no es de tu empresa" y "no es administrador" dan el mismo mensaje', () => {
    // Quien pregunta por alguien que no es de su empresa no debería poder averiguar, probando
    // identificadores, si esa persona existe en otra.
    expect(REMOVAL_DENIAL_MESSAGES.TARGET_NOT_IN_ORGANIZATION).toBe(
      REMOVAL_DENIAL_MESSAGES.TARGET_NOT_ADMIN,
    );
  });
});

describe('cuántas veces se puede fallar un código', () => {
  const AHORA = new Date('2026-08-27T10:00:00.000Z');
  const limpio: AttemptState = { failedAttempts: 0, lockedUntil: null };

  it('cuenta los fallos sin bloquear todavía', () => {
    let estado = limpio;
    for (let i = 1; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
      estado = afterFailedAttempt(estado, AHORA);
      expect(estado.failedAttempts).toBe(i);
      expect(isLockedOut(estado, AHORA)).toBe(false);
    }
  });

  it('CRÍTICO: al llegar al tope, bloquea', () => {
    let estado = limpio;
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
      estado = afterFailedAttempt(estado, AHORA);
    }

    expect(isLockedOut(estado, AHORA)).toBe(true);
  });

  it('el bloqueo se levanta solo', () => {
    let estado = limpio;
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
      estado = afterFailedAttempt(estado, AHORA);
    }
    const dentroDeUnaHora = new Date(AHORA.getTime() + 3_600_000);

    expect(isLockedOut(estado, dentroDeUnaHora)).toBe(false);
  });

  it('un acierto pone el contador a cero', () => {
    expect(AFTER_SUCCESSFUL_ATTEMPT).toEqual(limpio);
  });

  it('sin bloqueo previo, no hay bloqueo', () => {
    expect(isLockedOut(limpio, AHORA)).toBe(false);
  });
});
