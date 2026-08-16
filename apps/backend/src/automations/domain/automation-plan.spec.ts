import {
  InvalidAutomationPlanError,
  MAX_ACTIONS_PER_AUTOMATION,
  parseAutomationActions,
  parseScheduleTrigger,
} from './automation-plan';

/**
 * Fase 6 — el reloj no puede convertirse en una puerta trasera.
 *
 * Lo que se prueba aquí es que una automatización no pueda declarar nada que el sistema no
 * sepa hacer ya de forma segura, y que un calendario mal formado se rechace mientras hay
 * alguien esperando la respuesta y no de madrugada, en silencio.
 */
describe('parseAutomationActions', () => {
  it('acepta las acciones del catálogo', () => {
    expect(parseAutomationActions([{ type: 'RUN_ANALYSIS' }])).toEqual([
      { type: 'RUN_ANALYSIS' },
    ]);
  });

  describe('el catálogo es CERRADO', () => {
    it.each([
      ['tipo desconocido', [{ type: 'SEND_EMAIL', to: 'jefe@empresa.com' }]],
      ['llamada externa', [{ type: 'HTTP_REQUEST', url: 'https://x.test' }]],
      ['consulta libre', [{ type: 'SQL_QUERY', sql: 'SELECT 1' }]],
      ['ejecución de código', [{ type: 'EVAL', code: 'process.exit()' }]],
    ])('RECHAZA %s', (_caso, actions) => {
      // Aceptarlo convertiría una automatización en un intérprete de instrucciones
      // arbitrarias que corren sin nadie delante: el Principio de Evolución Asistida dejaría
      // de estar garantizado por la arquitectura.
      expect(() => parseAutomationActions(actions)).toThrow(
        InvalidAutomationPlanError,
      );
    });

    it('un tipo desconocido NO se ignora en silencio junto a otros válidos', () => {
      // Saltárselo dejaría una automatización que dice hacer dos cosas y hace una, sin que
      // nadie pueda saber cuál falta mirando su definición.
      expect(() =>
        parseAutomationActions([
          { type: 'RUN_ANALYSIS' },
          { type: 'SEND_EMAIL' },
        ]),
      ).toThrow(/tipo desconocido/i);
    });
  });

  describe('la lista está acotada', () => {
    it('una automatización sin acciones no hace nada y se rechaza', () => {
      expect(() => parseAutomationActions([])).toThrow(/al menos una acción/i);
    });

    it.each([
      ['no es una lista', { type: 'RUN_ANALYSIS' }],
      ['es nula', null],
      ['contiene basura', [42]],
    ])('%s', (_caso, raw) => {
      expect(() => parseAutomationActions(raw)).toThrow(
        InvalidAutomationPlanError,
      );
    });

    it('una lista sin cota es una ejecución sin cota', () => {
      const demasiadas = Array.from(
        { length: MAX_ACTIONS_PER_AUTOMATION + 1 },
        () => ({ type: 'RUN_ANALYSIS' }),
      );

      expect(() => parseAutomationActions(demasiadas)).toThrow(/más de/i);
    });
  });
});

describe('parseScheduleTrigger', () => {
  it('acepta cron de cinco campos con zona horaria', () => {
    expect(
      parseScheduleTrigger({ cron: '0 8 * * 1', timezone: 'Europe/Madrid' }),
    ).toEqual({ cron: '0 8 * * 1', timezone: 'Europe/Madrid' });
  });

  it('normaliza los espacios sobrantes', () => {
    expect(
      parseScheduleTrigger({
        cron: '  0   8  *  *  1  ',
        timezone: 'Europe/Madrid',
      }).cron,
    ).toBe('0 8 * * 1');
  });

  it.each(['*/30 * * * *', '0 */6 * * *', '15,45 9-18 * * 1-5'])(
    'acepta la expresión %s',
    (cron) => {
      expect(parseScheduleTrigger({ cron, timezone: 'UTC' }).cron).toBe(cron);
    },
  );

  it('EXIGE zona horaria: "los lunes a las 8" no es lo mismo en cada sitio', () => {
    expect(() => parseScheduleTrigger({ cron: '0 8 * * 1' })).toThrow(
      /zona horaria/i,
    );
  });

  describe('rechaza lo que no puede ejecutarse', () => {
    it('no admite segundos', () => {
      // Seis campos serían granularidad de segundo sobre un motor que llama a modelos.
      expect(() =>
        parseScheduleTrigger({ cron: '0 0 8 * * 1', timezone: 'UTC' }),
      ).toThrow(/cinco campos/i);
    });

    it.each([
      ['expresión vacía', ''],
      ['texto libre', 'todos los lunes por la mañana'],
      ['campos insuficientes', '0 8 *'],
      ['carácter no válido', '0 8 * * L'],
    ])('%s', (_caso, cron) => {
      // Una expresión que solo falla al dispararse deja una automatización "activa" que no
      // corre nunca, y nadie se entera hasta echar de menos el resultado.
      expect(() => parseScheduleTrigger({ cron, timezone: 'UTC' })).toThrow(
        InvalidAutomationPlanError,
      );
    });

    it('sin calendario no hay automatización programada', () => {
      expect(() => parseScheduleTrigger(null)).toThrow(/calendario/i);
    });
  });
});
