import { Injectable, Logger } from '@nestjs/common';
import type { GoogleTokens } from '../domain/ports/google-drive.port';
import type {
  GmailLabel,
  GmailMessage,
  GmailPort,
  GmailSyncResult,
} from '../domain/ports/gmail.port';
import { GMAIL_SCOPES } from '../domain/oauth-state';
import { GoogleOAuthClient, googleEndpoint } from './google-oauth.client';

/** Base de la API. Redirigible fuera de producción para poder probar el flujo entero. */
const gmailApi = () =>
  googleEndpoint(
    'https://gmail.googleapis.com/gmail/v1/users/me',
    'GMAIL_API_URL',
  );

/** Tope por sincronización. El conector vuelve a aplicar el suyo; este evita el gasto de red. */
const MAX_MESSAGES = 200;
/** Techo de páginas: una etiqueta enorme no puede convertir una sincronización en infinita. */
const MAX_PAGES = 5;

interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
  headers?: { name: string; value: string }[];
}

interface GmailRawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayloadPart;
}

/**
 * Lo único que es de Google en la integración de Gmail.
 *
 * Todo lo que importa —el perímetro de colección, la frontera de etiqueta, qué parte de un correo
 * es conocimiento y qué parte es metadata operativa, el recorte del historial citado, la
 * idempotencia y el versionado— vive por encima de este puerto y se verifica sin credenciales ni
 * red. Aquí solo hay llamadas HTTP y descodificación de MIME.
 *
 * ## El marcador de Gmail caduca, y hay que sobrevivir a ello
 *
 * Gmail no garantiza cuánto conserva un `historyId`: una fuente pausada dos semanas ya basta para
 * perderlo, y entonces la API responde 404. Eso NO es un fallo de sincronización — se cae a
 * lectura completa de la etiqueta y se dice (`expired`), porque la deduplicación por hash hace
 * que releer sea inofensivo y quedarse parado sí sería una pérdida real de conocimiento.
 *
 * ## Ni asunto, ni remitente, ni cuerpo en los registros
 *
 * Un asunto de correo puede ser «Despido de Juan». Aquí solo se registran recuentos y códigos de
 * estado. Es la diferencia cualitativa entre un buzón y una carpeta compartida.
 */
@Injectable()
export class GmailAdapter implements GmailPort {
  private readonly logger = new Logger(GmailAdapter.name);

  constructor(private readonly oauth: GoogleOAuthClient) {}

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
  }): string {
    // Los permisos MÍNIMOS de esta V1, y solo esos. Ver `GMAIL_SCOPES`.
    return this.oauth.buildAuthorizationUrl({
      ...params,
      scopes: GMAIL_SCOPES,
    });
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<GoogleTokens> {
    return this.oauth.exchangeCode(params);
  }

  async accountEmail(params: { accessToken: string }): Promise<string | null> {
    const profile = await this.get<{ emailAddress?: string }>(
      `${gmailApi()}/profile`,
      params.accessToken,
    );
    return profile.emailAddress ?? null;
  }

  /**
   * Etiquetas del buzón, para que la persona elija la frontera de sincronización.
   *
   * Se ofrecen todas, incluidas las del sistema: una pyme organiza el correo relevante con la
   * etiqueta que ya usa, y obligarla a crear una nueva solo para BusinessBrain haría que nadie
   * lo hiciera.
   */
  async listLabels(params: { accessToken: string }): Promise<GmailLabel[]> {
    const body = await this.get<{ labels?: GmailLabel[] }>(
      `${gmailApi()}/labels`,
      params.accessToken,
    );

    return (body.labels ?? [])
      .map((label) => ({ id: label.id, name: label.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async listMessages(params: {
    accessToken: string;
    labelId: string;
    historyId?: string;
  }): Promise<GmailSyncResult> {
    // El marcador se toma ANTES de leer. Tomarlo después perdería los mensajes que llegaran
    // durante la propia sincronización: la siguiente preguntaría por lo posterior a algo que
    // nunca se leyó.
    const historyId = await this.currentHistoryId(params.accessToken);

    if (!params.historyId) {
      const messages = await this.hydrate(
        await this.listIdsInLabel(params),
        params.accessToken,
      );
      return { messages, historyId, expired: false };
    }

    const incremental = await this.changedSince(params);
    if (incremental === 'EXPIRED') {
      // Caída a completa. Releer es inofensivo —la deduplicación por hash lo absorbe— y
      // quedarse parado sí perdería conocimiento.
      const messages = await this.hydrate(
        await this.listIdsInLabel(params),
        params.accessToken,
      );
      return { messages, historyId, expired: true };
    }

    return {
      messages: await this.hydrate(incremental, params.accessToken),
      historyId,
      expired: false,
    };
  }

  async listPresentMessageIds(params: {
    accessToken: string;
    labelId: string;
  }): Promise<string[]> {
    // Solo identificadores: no se pide ni un cuerpo. Es lo que permite detectar que un mensaje
    // salió de la etiqueta sin renunciar al incremental.
    return this.listIdsInLabel(params);
  }

  /** Marcador actual del buzón. */
  private async currentHistoryId(accessToken: string): Promise<string> {
    const profile = await this.get<{ historyId: string }>(
      `${gmailApi()}/profile`,
      accessToken,
    );
    return profile.historyId;
  }

  /**
   * Qué cambió desde el marcador, o `EXPIRED` si Gmail ya no lo reconoce.
   *
   * Se piden dos tipos de cambio: `messageAdded` (correo nuevo) y `labelAdded` (correo antiguo
   * que alguien acaba de mover a la etiqueta sincronizada). Sin el segundo, clasificar un correo
   * viejo dentro de la etiqueta no lo traería nunca.
   */
  private async changedSince(params: {
    accessToken: string;
    labelId: string;
    historyId?: string;
  }): Promise<string[] | 'EXPIRED'> {
    const ids = new Set<string>();
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        startHistoryId: params.historyId!,
        labelId: params.labelId,
        maxResults: '500',
      });
      query.append('historyTypes', 'messageAdded');
      query.append('historyTypes', 'labelAdded');
      if (pageToken) query.set('pageToken', pageToken);

      const response = await fetch(
        `${gmailApi()}/history?${query.toString()}`,
        this.authorized(params.accessToken),
      );

      if (response.status === 404) return 'EXPIRED';
      if (!response.ok) {
        throw new Error(
          `Gmail devolvió ${response.status} al pedir los cambios de la etiqueta`,
        );
      }

      const body = (await response.json()) as {
        history?: {
          messagesAdded?: { message: { id: string } }[];
          labelsAdded?: { message: { id: string } }[];
        }[];
        nextPageToken?: string;
      };

      for (const entry of body.history ?? []) {
        for (const added of [
          ...(entry.messagesAdded ?? []),
          ...(entry.labelsAdded ?? []),
        ]) {
          ids.add(added.message.id);
        }
      }

      pageToken = body.nextPageToken;
      if (!pageToken || ids.size >= MAX_MESSAGES) break;
    }

    return [...ids].slice(0, MAX_MESSAGES);
  }

  /** Identificadores de los mensajes que están AHORA en la etiqueta. */
  private async listIdsInLabel(params: {
    accessToken: string;
    labelId: string;
  }): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        labelIds: params.labelId,
        maxResults: '100',
      });
      if (pageToken) query.set('pageToken', pageToken);

      const body = await this.get<{
        messages?: { id: string }[];
        nextPageToken?: string;
      }>(`${gmailApi()}/messages?${query.toString()}`, params.accessToken);

      ids.push(...(body.messages ?? []).map((message) => message.id));
      pageToken = body.nextPageToken;
      if (!pageToken || ids.length >= MAX_MESSAGES) break;
    }

    return ids.slice(0, MAX_MESSAGES);
  }

  /**
   * Trae el contenido de cada mensaje.
   *
   * De uno en uno porque Gmail no ofrece lectura por lotes de mensajes completos. Un mensaje que
   * ya no existe —borrado entre el listado y la lectura— se omite sin tumbar la sincronización:
   * es una carrera normal en un buzón vivo, no un error.
   */
  private async hydrate(
    ids: string[],
    accessToken: string,
  ): Promise<GmailMessage[]> {
    const messages: GmailMessage[] = [];
    let unreadable = 0;

    for (const id of ids.slice(0, MAX_MESSAGES)) {
      try {
        const raw = await this.get<GmailRawMessage>(
          `${gmailApi()}/messages/${id}?format=full`,
          accessToken,
        );
        messages.push(this.toMessage(raw));
      } catch (error) {
        unreadable += 1;
        // Solo el identificador y el motivo: ni asunto ni remitente en los registros.
        this.logger.debug(
          `No se pudo leer el mensaje ${id}: ${(error as Error).message}`,
        );
      }
    }

    if (unreadable > 0) {
      this.logger.warn(
        `${unreadable} mensaje(s) no se pudieron leer y se omiten en esta sincronización`,
      );
    }

    return messages;
  }

  private toMessage(raw: GmailRawMessage): GmailMessage {
    const headers = raw.payload?.headers ?? [];
    const from = parseFrom(headerOf(headers, 'From'));

    return {
      id: raw.id,
      threadId: raw.threadId,
      subject: headerOf(headers, 'Subject'),
      fromName: from.name,
      fromAddress: from.address,
      sentAt: raw.internalDate
        ? new Date(Number(raw.internalDate)).toISOString()
        : (headerOf(headers, 'Date') ?? null),
      body: extractPlainText(raw.payload),
      labelIds: raw.labelIds ?? [],
    };
  }

  private async get<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, this.authorized(accessToken));

    if (!response.ok) {
      // El cuerpo de la respuesta NO se registra: en Gmail puede contener fragmentos del
      // mensaje. Solo el código de estado.
      throw new Error(`Gmail devolvió ${response.status}`);
    }

    return (await response.json()) as T;
  }

  private authorized(accessToken: string): RequestInit {
    return { headers: { Authorization: `Bearer ${accessToken}` } };
  }
}

function headerOf(
  headers: { name: string; value: string }[],
  name: string,
): string | null {
  // Las cabeceras de correo no distinguen mayúsculas y los clientes no son consistentes.
  const found = headers.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

/**
 * Separa el nombre de la dirección en una cabecera `From`.
 *
 * La separación no es cosmética: el nombre entra en el conocimiento y la dirección NO —queda
 * como metadata operativa, por decisión de producto (ver `gmail-message.ts`)—. Cuando la
 * cabecera solo trae la dirección, el nombre queda nulo antes que rellenarlo con el buzón: un
 * `contentText` que dijera «De: ana.garcia» seguiría siendo dato personal indexado.
 */
export function parseFrom(header: string | null): {
  name: string | null;
  address: string | null;
} {
  if (!header) return { name: null, address: null };

  const withName = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(header);
  if (withName) {
    const name = withName[1].trim();
    return { name: name.length > 0 ? name : null, address: withName[2].trim() };
  }

  return { name: null, address: header.trim() || null };
}

/**
 * Cuerpo del mensaje en texto plano.
 *
 * Se prefiere la parte `text/plain`; si el correo solo trae HTML se convierte, porque muchos
 * remitentes comerciales no envían alternativa en texto y descartarlos dejaría fuera justo el
 * correo de proveedores y clientes.
 *
 * Los adjuntos NO se recorren: quedan fuera de esta V1 por decisión de producto. Aquí eso se
 * traduce en que solo se miran partes `text/*`, así que un PDF ni se descarga ni se lista.
 */
export function extractPlainText(payload?: GmailPayloadPart): string {
  if (!payload) return '';

  const plain = findPart(payload, 'text/plain');
  if (plain) return decodeBody(plain);

  const html = findPart(payload, 'text/html');
  return html ? htmlToText(decodeBody(html)) : '';
}

function findPart(
  part: GmailPayloadPart,
  mimeType: string,
): GmailPayloadPart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;

  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }

  return null;
}

function decodeBody(part: GmailPayloadPart): string {
  const data = part.body?.data;
  if (!data) return '';
  // Gmail entrega base64url, no base64 estándar.
  return Buffer.from(data, 'base64url').toString('utf8');
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
