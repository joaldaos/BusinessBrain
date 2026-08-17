import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  ConnectorPort,
  ExtractedContent,
} from '../../knowledge-engine/domain/ports/connector.port';
import { GMAIL_PORT, type GmailPort } from '../domain/ports/gmail.port';
import {
  belongsToSyncedLabel,
  knowledgeFromMessage,
} from '../domain/gmail-message';
import { IntegrationsService } from '../application/integrations.service';

/** Config que declara una `KnowledgeSource` de Gmail. Se cifra en reposo. */
export interface GmailConnectorConfig {
  integrationId: string;
  /** Etiqueta que actúa de FRONTERA: nada de fuera de ella entra en BusinessBrain. */
  labelId: string;
  labelName?: string;
}

export interface GmailConnectorInput {
  config?: Record<string, unknown>;
  organizationId?: string;
  cursor?: string;
  onCursor?: (cursor: string) => void;
  onPresentAtSource?: (sourceUrls: string[]) => void;
}

/** Tope por sincronización: un buzón grande no puede agotar una ejecución. */
const MAX_MESSAGES_PER_SYNC = 200;

/**
 * Conector de Gmail — V1: solo el contenido de los mensajes.
 *
 * `PULL`, igual que Drive y web: nadie sube nada, el servidor va a buscarlo con lo que declara
 * la fuente. Por eso puede programarse con `SYNC_KNOWLEDGE_SOURCE`.
 *
 * ## La etiqueta es una frontera, y se comprueba DOS veces
 *
 * Se le pide a Gmail solo esa etiqueta **y** se vuelve a comprobar cada mensaje de este lado.
 * El filtro de la API es una consulta, no un permiso: el token de `gmail.readonly` puede leer
 * el buzón entero, así que la única garantía real de que no entra correo de fuera del perímetro
 * es la comprobación propia. Fail-closed.
 *
 * ## Los adjuntos quedan fuera de V1
 *
 * No se descargan ni se listan. Podrán convertirse en `KnowledgeItem` independientes
 * reutilizando esta misma tubería, pero no ampliamos el alcance ahora.
 *
 * ## Nada del contenido del correo llega a los registros
 *
 * Ni asunto, ni remitente, ni cuerpo. Un asunto puede ser «Despido de Juan» o «Oferta de compra
 * de la empresa», y los registros se envían a terceros con frecuencia. Solo identificadores
 * opacos y recuentos — es la diferencia cualitativa entre el correo y un documento de Drive.
 */
@Injectable()
export class GmailConnector implements ConnectorPort {
  private readonly logger = new Logger(GmailConnector.name);

  readonly key = 'gmail_v1';
  readonly acquisition = 'PULL' as const;
  /**
   * Un buzón no es una carpeta compartida: exige un perímetro de acceso restringido.
   *
   * Se declara en el conector y no en una comprobación por clave para que la exigencia sea
   * estructural — quien añada otra fuente sensible solo tiene que declararlo.
   */
  readonly requiresRestrictedCollection = true;

  constructor(
    @Inject(GMAIL_PORT) private readonly gmail: GmailPort,
    private readonly integrations: IntegrationsService,
  ) {}

  async extract(input: GmailConnectorInput): Promise<ExtractedContent[]> {
    const { integrationId, labelId } = this.readConfig(input);

    if (!input.organizationId) {
      // Sin organización no se puede resolver la conexión, y resolverla sin ella permitiría
      // usar la de otro tenant.
      throw new BadRequestException(
        'No se pudo resolver la organización de la sincronización',
      );
    }

    // Aquí es donde una conexión revocada detiene la sincronización.
    const accessToken = await this.integrations.accessTokenFor({
      organizationId: input.organizationId,
      integrationId,
    });

    const result = await this.gmail.listMessages({
      accessToken,
      labelId,
      historyId: input.cursor,
    });

    if (result.expired && input.cursor) {
      // Gmail no garantiza cuánto conserva un `historyId`. Se dice, porque significa que esta
      // ejecución fue completa y no incremental.
      this.logger.warn(
        `El marcador de sincronización caducó en Gmail: esta ejecución vuelve a leer la ` +
          `etiqueta completa`,
      );
    }

    input.onCursor?.(result.historyId);

    if (input.onPresentAtSource) {
      const presentIds = await this.gmail.listPresentMessageIds({
        accessToken,
        labelId,
      });
      input.onPresentAtSource(presentIds.map((id) => this.sourceUrlOf(id)));
    }

    return this.toKnowledge(result.messages, labelId);
  }

  /**
   * De mensajes a conocimiento.
   *
   * Un mensaje que no aporta nada —un «gracias», una confirmación automática— se omite en
   * silencio: un buzón real está lleno de ellos y ninguno debe hacer fallar la sincronización.
   */
  private toKnowledge(
    messages: import('../domain/ports/gmail.port').GmailMessage[],
    labelId: string,
  ): ExtractedContent[] {
    const extracted: ExtractedContent[] = [];
    let outsidePerimeter = 0;
    let withoutKnowledge = 0;

    for (const message of messages.slice(0, MAX_MESSAGES_PER_SYNC)) {
      if (!belongsToSyncedLabel(message, labelId)) {
        // Segunda comprobación, de este lado. Es la única garantía real del perímetro.
        outsidePerimeter += 1;
        continue;
      }

      const knowledge = knowledgeFromMessage(message);
      if (!knowledge) {
        withoutKnowledge += 1;
        continue;
      }

      const rawContent = Buffer.from(knowledge.contentText, 'utf8');
      extracted.push({
        title: knowledge.title,
        mimeType: 'text/plain',
        sizeBytes: rawContent.byteLength,
        sourceUrl: this.sourceUrlOf(message.id),
        rawContent,
        // Hilo y dirección del remitente: operativos, nunca indexados ni recuperables.
        sourceMetadata: knowledge.sourceMetadata,
      });
    }

    if (outsidePerimeter > 0) {
      // Sin asunto ni remitente: solo el recuento. Que ocurra ya es señal suficiente.
      this.logger.warn(
        `${outsidePerimeter} mensaje(s) llegaron fuera de la etiqueta sincronizada y se ` +
          `descartaron`,
      );
    }
    if (withoutKnowledge > 0) {
      this.logger.debug(
        `${withoutKnowledge} mensaje(s) sin contenido aprovechable, omitidos`,
      );
    }

    return extracted;
  }

  /** Enlace citable, y a la vez identidad estable del mensaje en su origen. */
  private sourceUrlOf(messageId: string): string {
    return `https://mail.google.com/mail/u/0/#all/${messageId}`;
  }

  private readConfig(input: GmailConnectorInput): {
    integrationId: string;
    labelId: string;
  } {
    const integrationId = input?.config?.integrationId;
    const labelId = input?.config?.labelId;

    if (typeof integrationId !== 'string' || integrationId.length === 0) {
      throw new BadRequestException(
        'Esta fuente no está asociada a ninguna conexión de Gmail',
      );
    }
    if (typeof labelId !== 'string' || labelId.length === 0) {
      // Sin etiqueta no hay frontera, y sin frontera se sincronizaría el buzón entero.
      throw new BadRequestException(
        'Esta fuente no tiene ninguna etiqueta de Gmail configurada: sin etiqueta no hay ' +
          'perímetro de sincronización',
      );
    }

    return { integrationId, labelId };
  }
}
