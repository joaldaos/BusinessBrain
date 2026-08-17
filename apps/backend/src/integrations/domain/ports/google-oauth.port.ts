import type { GoogleTokens } from './google-drive.port';

/**
 * Operaciones de token compartidas por todos los proveedores de Google.
 *
 * Drive y Gmail usan el MISMO endpoint de token y el mismo de revocación: son dos APIs de la
 * misma cuenta. Extraer esas dos operaciones evita que `IntegrationsService` —que custodia los
 * tokens de cualquier proveedor— dependa del puerto de uno concreto, y evita duplicar la
 * lógica de refresco cada vez que se añade una integración de Google.
 */
export const GOOGLE_OAUTH_PORT = Symbol('GOOGLE_OAUTH_PORT');

export interface GoogleOAuthPort {
  refreshTokens(refreshToken: string): Promise<GoogleTokens>;
  /** Invalida el consentimiento en Google, no solo en nuestra base de datos. */
  revoke(token: string): Promise<void>;
}
