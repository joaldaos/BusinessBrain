import { Injectable, Logger } from '@nestjs/common';
import type { AlertsPort } from '../domain/alerts.port';
import {
  externalAlertText,
  internalAlertText,
  type OperationalAlert,
} from '../domain/operational-alert';
import type { HttpClientPort } from '../../llm/domain/ports/http-client.port';

/**
 * El canal por defecto: el registro del servidor.
 *
 * No es un sustituto de nada — es el sitio donde el detalle completo puede vivir sin salir del
 * despliegue. Aunque haya un canal externo configurado, esto se escribe igualmente: el mensaje
 * de chat dice "ve a mirar", y esto es lo que se mira.
 */
@Injectable()
export class LogAlertsAdapter implements AlertsPort {
  private readonly logger = new Logger('AlertaOperativa');

  raise(alert: OperationalAlert): Promise<void> {
    this.logger.error(internalAlertText(alert));
    return Promise.resolve();
  }
}

/**
 * Un canal externo: cualquier URL que acepte un `POST` con `{ "text": "..." }`.
 *
 * Ese formato es el de Slack y el de Mattermost, y el que cualquier automatización sabe
 * recibir. No se adopta un SDK: sería atarse a un proveedor de chat para mandar una frase.
 *
 * ## Lo que se manda, y lo que no
 *
 * Solo identificadores. Ni el nombre de la empresa, ni el de la fuente, ni el mensaje de error
 * —que puede citar el título de un documento del cliente—. Un canal de chat es un tercero más.
 * Quien lo recibe tiene acceso al sistema: con el identificador va y mira el registro.
 *
 * ## Un fallo aquí no puede romper nada
 *
 * Si el canal no responde, se registra y se sigue. Una alerta que tumba la operación que
 * estaba avisando de que había fallado sería el peor resultado posible.
 */
@Injectable()
export class WebhookAlertsAdapter implements AlertsPort {
  private readonly logger = new Logger('AlertaOperativa');

  constructor(
    private readonly url: string,
    private readonly http: HttpClientPort,
    private readonly fallback: AlertsPort,
  ) {}

  async raise(alert: OperationalAlert): Promise<void> {
    // El detalle completo se queda dentro, siempre.
    await this.fallback.raise(alert);

    try {
      await this.http.postJson(
        this.url,
        { text: externalAlertText(alert) },
        { 'content-type': 'application/json' },
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar al canal externo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
