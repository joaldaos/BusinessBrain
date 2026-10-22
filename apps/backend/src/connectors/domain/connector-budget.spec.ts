import {
  budgetReachedMessage,
  dailyEventLimitFrom,
  DEFAULT_DAILY_EVENT_LIMIT,
  remainingToday,
} from './connector-budget';

/**
 * El techo diario de hechos.
 *
 * A diferencia del techo de IA —que protege al cliente de su propia factura, porque la clave
 * del proveedor es suya— este nos protege a nosotros: el almacenamiento es nuestro y cada
 * hecho entra después en medias, ventanas y comparaciones.
 */
describe('dailyEventLimitFrom', () => {
  it('usa el techo que la empresa haya fijado', () => {
    expect(
      dailyEventLimitFrom({ connectors: { dailyEventLimit: 120_000 } }),
    ).toBe(120_000);
  });

  it('cae al de por defecto cuando no hay ajuste', () => {
    expect(dailyEventLimitFrom({})).toBe(DEFAULT_DAILY_EVENT_LIMIT);
    expect(dailyEventLimitFrom(null)).toBe(DEFAULT_DAILY_EVENT_LIMIT);
    expect(dailyEventLimitFrom(undefined)).toBe(DEFAULT_DAILY_EVENT_LIMIT);
  });

  /**
   * Una errata en un ajuste no puede dejar a nadie sin producto (techo 0) ni sin techo
   * (techo infinito). Las dos consecuencias son peores que ignorar el valor malo.
   */
  it.each([
    ['cero', 0],
    ['negativo', -5],
    ['texto', 'muchos'],
    ['no finito', Infinity],
    ['NaN', NaN],
    ['nulo', null],
  ])('ignora un valor %s y mantiene el techo', (_caso, dailyEventLimit) => {
    expect(dailyEventLimitFrom({ connectors: { dailyEventLimit } })).toBe(
      DEFAULT_DAILY_EVENT_LIMIT,
    );
  });

  it('no se confunde con el ajuste del techo de IA', () => {
    // Los dos viven en `settings` y son topes diarios: leer el que no toca daría un número
    // plausible y completamente equivocado.
    expect(
      dailyEventLimitFrom({ ai: { dailyCharacterLimit: 5_000_000 } }),
    ).toBe(DEFAULT_DAILY_EVENT_LIMIT);
  });
});

describe('remainingToday', () => {
  it('descuenta lo consumido', () => {
    expect(remainingToday(50_000, 12_000)).toBe(38_000);
  });

  it('nunca es negativo aunque se haya pasado', () => {
    // Pasarse es posible: el lote que cruza el umbral se escribe entero, igual que en el
    // techo de IA, porque cortarlo a la mitad dejaría una comanda sin su hecho de cierre.
    expect(remainingToday(50_000, 73_000)).toBe(0);
  });
});

describe('budgetReachedMessage', () => {
  it('habla el idioma de la empresa, no el del sistema', () => {
    const mensaje = budgetReachedMessage(50_000);

    expect(mensaje).toMatch(/50\.000/);
    expect(mensaje).toMatch(/mañana/i);
    // Ni métricas, ni ventanas, ni nombres internos.
    expect(mensaje).not.toMatch(/UsageRecord|metric|periodStart|cuota/i);
  });

  it('dice qué hacer si el negocio genera legítimamente más', () => {
    expect(budgetReachedMessage(50_000)).toMatch(
      /administrador|Configuración/i,
    );
  });
});
