import type { GoogleTokens } from '../src/integrations/domain/ports/google-drive.port';
import type {
  GmailLabel,
  GmailMessage,
  GmailPort,
  GmailSyncResult,
} from '../src/integrations/domain/ports/gmail.port';

/**
 * Gmail sustituible.
 *
 * Es la razón de que `GmailPort` exista: el perímetro de colección, la frontera de etiqueta, la
 * separación entre conocimiento y metadata operativa, la idempotencia y el versionado son lógica
 * NUESTRA y deben poder verificarse sin una cuenta de Google ni red en CI.
 *
 * Guarda mensajes en memoria con su marcador de historia para poder demostrar de verdad que la
 * segunda sincronización solo trae lo que cambió, y expone `historyExpired` para forzar la caída
 * a lectura completa — el caso que rompe una fuente pausada dos semanas.
 */
export class FakeGmail implements GmailPort {
  readonly labels: GmailLabel[] = [
    { id: 'Label_ventas', name: 'Ventas' },
    { id: 'Label_direccion', name: 'Dirección' },
  ];

  /** Mensajes por identificador, con el marcador en que entraron o cambiaron. */
  private readonly messages = new Map<
    string,
    { message: GmailMessage; historyId: number }
  >();

  private historyId = 100;

  /** Simula un marcador caducado: Gmail no garantiza cuánto lo conserva. */
  historyExpired = false;

  /** Qué se le ha pedido a "Gmail". Permite afirmar que el incremental lo es de verdad. */
  readonly calls: { listMessages: { historyId?: string }[] } = {
    listMessages: [],
  };

  /**
   * Coloca o reemplaza un mensaje, avanzando el marcador.
   *
   * Reutilizar el mismo `id` con otro `body` es cómo se simula un mensaje modificado: Gmail no
   * permite editar un correo, pero el sistema debe versionar si el contenido de un mismo origen
   * cambia, y esa garantía se verifica aquí.
   */
  putMessage(params: {
    id: string;
    threadId?: string;
    subject?: string | null;
    fromName?: string | null;
    fromAddress?: string | null;
    sentAt?: string;
    body: string;
    labelIds?: string[];
  }): void {
    this.historyId += 1;
    this.messages.set(params.id, {
      historyId: this.historyId,
      message: {
        id: params.id,
        threadId: params.threadId ?? `hilo-${params.id}`,
        subject: params.subject === undefined ? 'Asunto' : params.subject,
        fromName:
          params.fromName === undefined ? 'Ana García' : params.fromName,
        fromAddress:
          params.fromAddress === undefined
            ? 'ana.garcia@empresa.com'
            : params.fromAddress,
        sentAt: params.sentAt ?? '2026-08-12T09:30:00.000Z',
        body: params.body,
        labelIds: params.labelIds ?? ['Label_ventas'],
      },
    });
  }

  /** Saca un mensaje de la etiqueta sincronizada SIN borrarlo del buzón. */
  moveOutOfLabel(id: string, labelIds: string[] = ['Label_direccion']): void {
    const entry = this.messages.get(id);
    if (!entry) throw new Error(`mensaje ${id} inexistente`);
    this.historyId += 1;
    entry.message = { ...entry.message, labelIds };
  }

  buildAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
  }): string {
    return `https://accounts.google.test/authorize?state=${encodeURIComponent(params.state)}&redirect_uri=${encodeURIComponent(params.redirectUri)}`;
  }

  exchangeCode(params: { code: string }): Promise<GoogleTokens> {
    if (params.code === 'codigo-invalido') {
      return Promise.reject(new Error('invalid_grant'));
    }
    return Promise.resolve({
      accessToken: `acceso-${params.code}`,
      refreshToken: `refresco-${params.code}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      scope:
        params.code === 'codigo-sin-permisos'
          ? 'openid email'
          : 'https://www.googleapis.com/auth/gmail.readonly',
    });
  }

  accountEmail(): Promise<string | null> {
    return Promise.resolve('comercial@empresa.test');
  }

  listLabels(): Promise<GmailLabel[]> {
    return Promise.resolve(this.labels);
  }

  listMessages(params: {
    accessToken: string;
    labelId: string;
    historyId?: string;
  }): Promise<GmailSyncResult> {
    this.calls.listMessages.push({ historyId: params.historyId });

    const inLabel = [...this.messages.values()].filter((entry) =>
      entry.message.labelIds.includes(params.labelId),
    );

    if (params.historyId && this.historyExpired) {
      // Marcador caducado: se lee la etiqueta entera y se avisa. Releer es inofensivo —lo
      // absorbe la deduplicación por hash— y quedarse parado sí perdería conocimiento.
      return Promise.resolve({
        messages: inLabel.map((entry) => entry.message),
        historyId: String(this.historyId),
        expired: true,
      });
    }

    // Incremental de verdad: solo lo posterior al marcador, igual que hace Gmail.
    const since = params.historyId ? Number(params.historyId) : 0;
    return Promise.resolve({
      messages: inLabel
        .filter((entry) => entry.historyId > since)
        .map((entry) => entry.message),
      historyId: String(this.historyId),
      expired: false,
    });
  }

  listPresentMessageIds(params: {
    accessToken: string;
    labelId: string;
  }): Promise<string[]> {
    return Promise.resolve(
      [...this.messages.values()]
        .filter((entry) => entry.message.labelIds.includes(params.labelId))
        .map((entry) => entry.message.id),
    );
  }
}
