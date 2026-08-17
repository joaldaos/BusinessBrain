import { Injectable } from '@nestjs/common';
import type { GoogleTokens } from '../domain/ports/google-drive.port';
import type { GoogleOAuthPort } from '../domain/ports/google-oauth.port';
import { externalEndpoint } from '../../common/utils/external-endpoint';

const OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/**
 * Lo que Drive y Gmail comparten de Google: pedir tokens, refrescarlos y revocarlos.
 *
 * Son dos APIs de la MISMA cuenta y del mismo endpoint de token. Tenerlo una sola vez importa
 * por un motivo concreto de seguridad: el refresco y la revocación son las dos operaciones donde
 * un descuido no se nota —una revocación que falla en silencio deja el consentimiento vivo en la
 * cuenta de Google— y no conviene que cada integración nueva traiga su propia copia.
 *
 * Las credenciales se leen del entorno y **no se validan al arrancar**: una organización que no
 * use ninguna integración de Google no debe impedir que el sistema arranque. Se comprueban al
 * usarlas, diciendo exactamente qué falta.
 */
@Injectable()
export class GoogleOAuthClient implements GoogleOAuthPort {
  /**
   * URL de consentimiento para los permisos que pida quien llama.
   *
   * Los `scopes` los decide cada integración: aquí no se codifica ninguno, para que añadir una
   * no pueda ampliar por descuido lo que se pide para las demás.
   */
  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    scopes: readonly string[];
  }): string {
    const query = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: params.scopes.join(' '),
      // Sin `offline` Google no entrega token de refresco y la conexión moriría en una hora.
      access_type: 'offline',
      // Fuerza la pantalla de consentimiento: es la única forma de recuperar el token de
      // refresco si la persona ya había autorizado antes y nosotros lo perdimos.
      prompt: 'consent',
      state: params.state,
      include_granted_scopes: 'true',
    });

    return `${externalEndpoint(OAUTH_BASE, 'GOOGLE_OAUTH_BASE_URL')}?${query.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<GoogleTokens> {
    return this.requestTokens({
      code: params.code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    });
  }

  async refreshTokens(refreshToken: string): Promise<GoogleTokens> {
    return this.requestTokens({
      refresh_token: refreshToken,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      grant_type: 'refresh_token',
    });
  }

  async revoke(token: string): Promise<void> {
    const response = await fetch(
      externalEndpoint(REVOKE_URL, 'GOOGLE_REVOKE_URL'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      },
    );

    if (!response.ok) {
      throw new Error(`Google devolvió ${response.status} al revocar`);
    }
  }

  private async requestTokens(
    body: Record<string, string>,
  ): Promise<GoogleTokens> {
    const response = await fetch(
      externalEndpoint(TOKEN_URL, 'GOOGLE_TOKEN_URL'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
      },
    );

    if (!response.ok) {
      // El cuerpo de Google no lleva credenciales, solo el motivo (`invalid_grant`, etc.), y
      // saberlo es la diferencia entre diagnosticar una revocación y adivinar.
      throw new Error(
        `Google devolvió ${response.status} al pedir tokens: ${await response.text()}`,
      );
    }

    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + payload.expires_in * 1000),
      scope: payload.scope,
    };
  }

  private clientId(): string {
    return this.required('GOOGLE_CLIENT_ID');
  }

  private clientSecret(): string {
    return this.required('GOOGLE_CLIENT_SECRET');
  }

  private required(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `Falta ${name}: las integraciones con Google no están configuradas en este despliegue`,
      );
    }
    return value;
  }
}
