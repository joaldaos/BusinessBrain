import { BusinessEventKind } from '@businessbrain/database';
import { validateEvent, type NormalizedEvent } from './normalized-batch';

/**
 * Qué hecho es utilizable y cuál no.
 *
 * La regla de fondo es la del resto del producto: **ante un dato que no se entiende, ni se
 * inventa ni se calla.** Se descarta ese hecho, se cuenta y se dice el motivo — en vez de
 * escribirlo a medias y que una media salga mal seis semanas después sin que nadie sepa por
 * qué.
 */
describe('validateEvent', () => {
  const valido = (extra: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
    kind: BusinessEventKind.SALE_RECORDED,
    externalId: 'ticket-1',
    occurredAt: new Date('2026-10-17T21:30:00.000Z'),
    ...extra,
  });

  it('acepta un hecho con lo mínimo imprescindible', () => {
    expect(validateEvent(valido())).toBeNull();
  });

  it('acepta importe y moneda cuando vienen juntos', () => {
    expect(
      validateEvent(valido({ amountCents: 1_250, currency: 'EUR' })),
    ).toBeNull();
  });

  describe('identificador de origen', () => {
    it.each([
      ['', 'vacío'],
      ['   ', 'solo espacios'],
    ])(
      'rechaza un identificador %s (%s): sin él la idempotencia no existe',
      (externalId) => {
        expect(validateEvent(valido({ externalId }))).toMatch(
          /identificador de origen/i,
        );
      },
    );
  });

  describe('fecha', () => {
    it('rechaza una fecha inválida', () => {
      expect(
        validateEvent(valido({ occurredAt: new Date('no soy una fecha') })),
      ).toMatch(/fecha válida/i);
    });

    it('rechaza que no haya fecha en absoluto', () => {
      expect(validateEvent(valido({ occurredAt: undefined as never }))).toMatch(
        /fecha válida/i,
      );
    });
  });

  describe('dinero', () => {
    /**
     * Es el caso que más daño haría si pasara: un importe sin moneda acaba sumándose con
     * otros y nadie puede saber que la suma mezcla divisas.
     */
    it('rechaza un importe sin moneda', () => {
      expect(validateEvent(valido({ amountCents: 1_250 }))).toMatch(/juntos/i);
    });

    it('rechaza una moneda sin importe', () => {
      expect(validateEvent(valido({ currency: 'EUR' }))).toMatch(/juntos/i);
    });

    it('rechaza un importe con decimales: los céntimos son enteros', () => {
      expect(
        validateEvent(valido({ amountCents: 12.5, currency: 'EUR' })),
      ).toMatch(/céntimos enteros/i);
    });

    it('acepta un importe de cero, que es un importe', () => {
      expect(
        validateEvent(valido({ amountCents: 0, currency: 'EUR' })),
      ).toBeNull();
    });
  });

  describe('cantidad', () => {
    it('acepta cero y positivos', () => {
      expect(validateEvent(valido({ quantity: 0 }))).toBeNull();
      expect(validateEvent(valido({ quantity: 3 }))).toBeNull();
    });

    /** Una devolución es un hecho propio con su fecha, no un signo menos. */
    it('rechaza una cantidad negativa', () => {
      expect(validateEvent(valido({ quantity: -2 }))).toMatch(/negativa/i);
    });

    it('rechaza una cantidad no finita', () => {
      expect(validateEvent(valido({ quantity: Infinity }))).toMatch(
        /no finita/i,
      );
    });
  });

  it('un nulo explícito no es lo mismo que un valor malo: se acepta', () => {
    expect(
      validateEvent(
        valido({ amountCents: null, currency: null, quantity: null }),
      ),
    ).toBeNull();
  });

  it('el motivo que devuelve explica la consecuencia, no solo la regla', () => {
    const motivo = validateEvent(valido({ externalId: '' }));
    // Quien lea el diagnóstico tiene que entender por qué importa, no solo qué falló.
    expect(motivo!.length).toBeGreaterThan(30);
  });
});
