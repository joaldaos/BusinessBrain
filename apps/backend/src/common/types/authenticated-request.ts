import type { Request } from 'express';
import type { MembershipRole, PlatformRole } from '@businessbrain/database';
import type { Locale } from '../i18n/locales';

/** Lo que JwtStrategy.validate() adjunta a req.user tras verificar el access token. */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  /**
   * Idioma en el que se le habla a esta persona.
   *
   * Ya resuelto: si no ha elegido ninguno, aquí llega el de por defecto. Quien consume no
   * tiene que preguntarse qué hacer con un nulo, y el chat no puede quedarse sin idioma por
   * un campo vacío.
   *
   * NO es el idioma de los documentos de su empresa. Ver `common/i18n/locales.ts`.
   */
  locale: Locale;
  memberships: Array<{ organizationId: string; role: MembershipRole }>;
  /**
   * La sesión de la que viene esta petición.
   *
   * No es el token: el token rota cada quince minutos y la sesión no. Es lo que permite que
   * "esta sesión se reautenticó hace tres minutos" siga siendo cierto después de un refresco.
   */
  sessionId: string;
  /** Cuándo demostró la identidad esta SESIÓN. Nulo = nunca desde que empezó. */
  reauthenticatedAt: Date | null;
  /** Si la cuenta tiene la verificación en dos pasos activa (no solo empezada). */
  mfaEnabled: boolean;
}

/** Lo que OrgRoleGuard adjunta a req.organization tras resolver la organización activa. */
export interface RequestOrganization {
  id: string;
  slug: string;
  role: MembershipRole;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  organization?: RequestOrganization;
}
