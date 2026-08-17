import {
  MIN_MESSAGE_TEXT_LENGTH,
  belongsToSyncedLabel,
  knowledgeFromMessage,
  stripQuotedHistory,
  type GmailMessageInput,
} from './gmail-message';

const CUERPO =
  'La política de descuentos comerciales supera el margen objetivo de forma recurrente y ' +
  'conviene revisar los umbrales por segmento antes del cierre del trimestre.';

const message = (
  overrides: Partial<GmailMessageInput> = {},
): GmailMessageInput => ({
  id: 'msg-1',
  threadId: 'hilo-1',
  subject: 'Política de descuentos',
  fromName: 'Ana García',
  fromAddress: 'ana.garcia@empresa.com',
  sentAt: '2026-08-12T09:30:00.000Z',
  body: CUERPO,
  labelIds: ['Label_ventas'],
  ...overrides,
});

describe('stripQuotedHistory', () => {
  it('corta en la atribución de Gmail en español', () => {
    // Sin recortar, cada respuesta reingiere el hilo entero.
    const body = stripQuotedHistory(
      `${CUERPO}\n\nEl 11 ago 2026, Luis Pérez escribió:\n> Mensaje anterior completo`,
    );

    expect(body).toBe(CUERPO);
    expect(body).not.toContain('Mensaje anterior');
  });

  it('corta en la atribución en inglés', () => {
    const body = stripQuotedHistory(
      `${CUERPO}\n\nOn Tue, 11 Aug 2026 at 10:00, Luis wrote:\n> antes`,
    );
    expect(body).toBe(CUERPO);
  });

  it('corta en un reenvío', () => {
    const body = stripQuotedHistory(
      `${CUERPO}\n\n---------- Mensaje reenviado ----------\nDe: alguien`,
    );
    expect(body).toBe(CUERPO);
  });

  it('descarta las líneas citadas aunque no haya atribución', () => {
    expect(stripQuotedHistory(`${CUERPO}\n> citado\n> más citado`)).toBe(
      CUERPO,
    );
  });

  it('un mensaje sin citas se conserva entero', () => {
    expect(stripQuotedHistory(CUERPO)).toBe(CUERPO);
  });
});

describe('knowledgeFromMessage', () => {
  it('CRÍTICO: la dirección del remitente NO entra en el conocimiento', () => {
    const knowledge = knowledgeFromMessage(message())!;

    // Puesta en el texto acabaría en embeddings, en el chat y en PDFs descargables.
    expect(knowledge.contentText).not.toContain('ana.garcia@empresa.com');
    expect(knowledge.title).not.toContain('@');
    // El nombre sí, para poder contextualizar de quién es el mensaje.
    expect(knowledge.contentText).toContain('Ana García');
    // Y la dirección queda como metadata operativa, trazable pero no recuperable.
    expect(knowledge.sourceMetadata.fromAddress).toBe('ana.garcia@empresa.com');
  });

  it('conserva el hilo como metadata, sin crear ninguna entidad', () => {
    const knowledge = knowledgeFromMessage(message())!;
    expect(knowledge.sourceMetadata.threadId).toBe('hilo-1');
    expect(knowledge.sourceMetadata.messageId).toBe('msg-1');
  });

  describe('el título es ÚNICO por mensaje', () => {
    it('dos respuestas del mismo hilo NO comparten título', () => {
      // Es lo que impide que la deduplicación estructural las tome por versiones: empareja
      // candidatos por igualdad de título dentro de la misma fuente.
      const primera = knowledgeFromMessage(
        message({ id: 'a', subject: 'Re: Descuentos', fromName: 'Ana' }),
      )!;
      const segunda = knowledgeFromMessage(
        message({
          id: 'b',
          subject: 'Re: Descuentos',
          fromName: 'Luis',
          sentAt: '2026-08-13T09:00:00.000Z',
        }),
      )!;

      expect(primera.title).not.toBe(segunda.title);
    });

    it('sin asunto no deja el título vacío', () => {
      const knowledge = knowledgeFromMessage(message({ subject: null }))!;
      expect(knowledge.title).toContain('(sin asunto)');
    });
  });

  describe('lo que no aporta conocimiento se omite, sin fallar', () => {
    it.each([
      ['un "gracias"', 'Gracias!'],
      ['una confirmación', 'Recibido, ok.'],
      ['un cuerpo vacío', ''],
      ['solo historial citado', 'El 11 ago 2026, Luis escribió:\n> todo'],
    ])('%s', (_caso, body) => {
      // Un buzón real está lleno de esto, y nada de ello debe tumbar una sincronización.
      expect(knowledgeFromMessage(message({ body }))).toBeNull();
    });

    it('el umbral se mide DESPUÉS de recortar la cita', () => {
      const body = `Vale.\n\nEl 11 ago 2026, Luis escribió:\n${'x'.repeat(500)}`;
      expect(knowledgeFromMessage(message({ body }))).toBeNull();
    });

    it('justo por encima del umbral sí entra', () => {
      const body = 'a'.repeat(MIN_MESSAGE_TEXT_LENGTH + 1);
      expect(knowledgeFromMessage(message({ body }))).not.toBeNull();
    });
  });
});

describe('belongsToSyncedLabel', () => {
  it('acepta un mensaje de la etiqueta sincronizada', () => {
    expect(belongsToSyncedLabel(message(), 'Label_ventas')).toBe(true);
  });

  it('CRÍTICO: RECHAZA un mensaje de fuera del perímetro', () => {
    // El filtro de la API de Gmail es una consulta, no una garantía. Se vuelve a comprobar de
    // este lado: un error de paginación no puede meter correo que nadie aceptó compartir.
    expect(belongsToSyncedLabel(message(), 'Label_direccion')).toBe(false);
    expect(belongsToSyncedLabel({ labelIds: [] }, 'Label_ventas')).toBe(false);
  });
});
