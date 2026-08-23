import {
  DEFAULT_DAILY_CHARACTER_LIMIT,
  charactersInMessages,
  charactersInTexts,
  dailyCharacterLimitFrom,
  dayWindow,
} from './ai-budget';

describe('techo de gasto en IA', () => {
  describe('el límite de cada empresa', () => {
    it('sale de sus ajustes', () => {
      expect(
        dailyCharacterLimitFrom({ ai: { dailyCharacterLimit: 1_000 } }),
      ).toBe(1_000);
    });

    it('CRÍTICO: un ajuste ausente o absurdo cae al de por defecto', () => {
      // Una errata en un ajuste no puede dejar a una empresa sin producto (límite 0) ni sin
      // techo (límite negativo o texto).
      for (const roto of [
        null,
        {},
        { ai: {} },
        { ai: { dailyCharacterLimit: 0 } },
        { ai: { dailyCharacterLimit: -5 } },
        { ai: { dailyCharacterLimit: 'mucho' } },
        { ai: { dailyCharacterLimit: Number.NaN } },
      ]) {
        expect(dailyCharacterLimitFrom(roto)).toBe(
          DEFAULT_DAILY_CHARACTER_LIMIT,
        );
      }
    });

    it('convive con el resto de ajustes de la empresa', () => {
      // `settings` ya guarda la exigencia de fiabilidad. Leer mal el objeto entero sería
      // pisarla.
      expect(
        dailyCharacterLimitFrom({
          knowledgeEngine: { confidence: { minimumFloor: 0.7 } },
          ai: { dailyCharacterLimit: 42 },
        }),
      ).toBe(42);
    });
  });

  describe('el día', () => {
    it('empieza a medianoche y dura exactamente un día', () => {
      const { start, end } = dayWindow(new Date('2026-08-23T17:45:12.500'));

      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
      expect(end.getTime() - start.getTime()).toBe(86_400_000);
    });

    it('dos instantes del mismo día caen en la misma ventana', () => {
      // Es lo que hace que el contador se acumule en una sola fila.
      expect(dayWindow(new Date('2026-08-23T00:00:01')).start.getTime()).toBe(
        dayWindow(new Date('2026-08-23T23:59:59')).start.getTime(),
      );
    });
  });

  describe('cuánto texto lleva una petición', () => {
    it('cuenta los mensajes', () => {
      expect(
        charactersInMessages([{ content: 'hola' }, { content: 'adiós' }]),
      ).toBe(9);
    });

    it('no se rompe con una petición vacía o rara', () => {
      expect(charactersInMessages(undefined)).toBe(0);
      expect(charactersInMessages([{}, { content: 42 }])).toBe(0);
      expect(charactersInTexts(undefined)).toBe(0);
    });

    it('cuenta todos los fragmentos que se vectorizan', () => {
      // Vectorizar es lo que más gasta: un documento entero troceado.
      expect(charactersInTexts(['abc', 'de', ''])).toBe(5);
    });
  });
});
