import { createHmac } from 'node:crypto';
import {
  computeSignature,
  REPLAY_WINDOW_MS,
  signedPayload,
  verifyWebhook,
} from './webhook-signature';

/**
 * La puerta de entrada de los envíos externos.
 *
 * Si esto falla, cualquiera que conozca la URL puede inyectar ventas que no ocurrieron, y
 * BusinessBrain las analizaría como ciertas — con conclusiones y recomendaciones encima. Un
 * dato falso aquí no es ruido: es una decisión empresarial equivocada con apariencia de estar
 * respaldada.
 */
describe('verifyWebhook', () => {
  const SECRETO = 'secreto-del-proveedor';
  const AHORA = new Date('2026-10-19T12:00:00.000Z');
  const CUERPO = JSON.stringify({ ticket: 'T-1', importe: 2450 });

  const envioValido = (extra: Record<string, unknown> = {}) => {
    const timestamp = String(AHORA.getTime());
    return {
      rawBody: CUERPO,
      timestamp,
      signature: computeSignature(SECRETO, timestamp, CUERPO),
      secret: SECRETO,
      now: AHORA,
      ...extra,
    };
  };

  it('acepta un envío bien firmado y dentro de ventana', () => {
    expect(verifyWebhook(envioValido())).toEqual({ ok: true });
  });

  describe('autenticidad', () => {
    it('rechaza una firma de otro secreto', () => {
      const timestamp = String(AHORA.getTime());
      const resultado = verifyWebhook(
        envioValido({
          signature: computeSignature('otro-secreto', timestamp, CUERPO),
        }),
      );

      expect(resultado).toEqual({ ok: false, reason: 'FIRMA_NO_COINCIDE' });
    });

    /** El caso que de verdad importa: el cuerpo se cambia pero se reusa la firma. */
    it('rechaza un cuerpo manipulado con la firma original', () => {
      const timestamp = String(AHORA.getTime());
      const firmaDelOriginal = computeSignature(SECRETO, timestamp, CUERPO);
      const manipulado = JSON.stringify({ ticket: 'T-1', importe: 999999 });

      expect(
        verifyWebhook(
          envioValido({ rawBody: manipulado, signature: firmaDelOriginal }),
        ),
      ).toEqual({ ok: false, reason: 'FIRMA_NO_COINCIDE' });
    });

    it('rechaza un envío sin firma', () => {
      expect(verifyWebhook(envioValido({ signature: undefined }))).toEqual({
        ok: false,
        reason: 'SIN_FIRMA',
      });
    });

    it('rechaza una firma vacía o truncada', () => {
      for (const signature of ['', 'abc']) {
        expect(verifyWebhook(envioValido({ signature })).ok).toBe(false);
      }
    });

    it('firma sobre los BYTES recibidos, no sobre el objeto reserializado', () => {
      // Mismo contenido, distinto espaciado: dos cuerpos distintos y dos firmas distintas.
      // Reserializar antes de verificar haría que ambos pasaran con la misma firma, y eso
      // deja entrar cualquier reescritura por el camino.
      const conEspacios = '{ "ticket": "T-1", "importe": 2450 }';
      const timestamp = String(AHORA.getTime());

      expect(computeSignature(SECRETO, timestamp, conEspacios)).not.toBe(
        computeSignature(SECRETO, timestamp, CUERPO),
      );
    });

    it('acepta el cuerpo como Buffer igual que como texto', () => {
      const timestamp = String(AHORA.getTime());
      expect(
        verifyWebhook(
          envioValido({
            rawBody: Buffer.from(CUERPO, 'utf8'),
            signature: computeSignature(SECRETO, timestamp, CUERPO),
          }),
        ),
      ).toEqual({ ok: true });
    });
  });

  describe('protección contra reenvíos', () => {
    it('rechaza un envío antiguo aunque su firma sea correcta', () => {
      const viejo = String(AHORA.getTime() - REPLAY_WINDOW_MS - 1_000);

      expect(
        verifyWebhook(
          envioValido({
            timestamp: viejo,
            signature: computeSignature(SECRETO, viejo, CUERPO),
          }),
        ),
      ).toEqual({ ok: false, reason: 'FUERA_DE_VENTANA' });
    });

    /**
     * La ventana se mira en los dos sentidos: un reloj adelantado —por error o a propósito—
     * dejaría una petición válida durante horas.
     */
    it('rechaza un envío del futuro', () => {
      const futuro = String(AHORA.getTime() + REPLAY_WINDOW_MS + 1_000);

      expect(
        verifyWebhook(
          envioValido({
            timestamp: futuro,
            signature: computeSignature(SECRETO, futuro, CUERPO),
          }),
        ),
      ).toEqual({ ok: false, reason: 'FUERA_DE_VENTANA' });
    });

    it('tolera un desfase pequeño de reloj en ambos sentidos', () => {
      for (const desfase of [-60_000, 60_000]) {
        const ts = String(AHORA.getTime() + desfase);
        expect(
          verifyWebhook(
            envioValido({
              timestamp: ts,
              signature: computeSignature(SECRETO, ts, CUERPO),
            }),
          ).ok,
        ).toBe(true);
      }
    });

    /**
     * LA prueba de esta sección. Si el instante no entrara en lo firmado, bastaría con
     * cambiarlo para que una petición capturada volviera a entrar en ventana conservando su
     * firma — y la protección sería decorativa.
     */
    it('cambiar el instante INVALIDA la firma: no basta con reescribirlo', () => {
      const original = String(AHORA.getTime() - REPLAY_WINDOW_MS - 1_000);
      const firmaCapturada = computeSignature(SECRETO, original, CUERPO);

      const resultado = verifyWebhook(
        envioValido({
          timestamp: String(AHORA.getTime()), // dentro de ventana
          signature: firmaCapturada, // pero firmada para el instante viejo
        }),
      );

      expect(resultado).toEqual({ ok: false, reason: 'FIRMA_NO_COINCIDE' });
    });

    it('rechaza un envío sin marca de tiempo', () => {
      expect(verifyWebhook(envioValido({ timestamp: undefined }))).toEqual({
        ok: false,
        reason: 'SIN_MARCA_DE_TIEMPO',
      });
    });

    it.each([['ayer'], [''], ['NaN']])(
      'rechaza una marca de tiempo que no es un número (%s)',
      (timestamp) => {
        const r = verifyWebhook(envioValido({ timestamp }));
        expect(r.ok).toBe(false);
        expect(['MARCA_DE_TIEMPO_INVALIDA', 'SIN_MARCA_DE_TIEMPO']).toContain(
          r.reason,
        );
      },
    );

    it('la ventana se puede estrechar para un proveedor exigente', () => {
      const ts = String(AHORA.getTime() - 30_000);
      const envio = envioValido({
        timestamp: ts,
        signature: computeSignature(SECRETO, ts, CUERPO),
      });

      expect(verifyWebhook({ ...envio, windowMs: 10_000 }).ok).toBe(false);
      expect(verifyWebhook({ ...envio, windowMs: 60_000 }).ok).toBe(true);
    });
  });

  describe('el contrato de la firma', () => {
    it('es un HMAC-SHA256 del instante y el cuerpo, comprobable desde fuera', () => {
      // Un proveedor implementa esto en su lado. Si la composición cambiara en silencio,
      // todos los envíos de todos los clientes empezarían a rechazarse a la vez.
      const ts = '1760875200000';
      const esperado = createHmac('sha256', SECRETO)
        .update(`${ts}.${CUERPO}`)
        .digest('hex');

      expect(computeSignature(SECRETO, ts, CUERPO)).toBe(esperado);
      expect(signedPayload(ts, CUERPO)).toBe(`${ts}.${CUERPO}`);
    });
  });
});
