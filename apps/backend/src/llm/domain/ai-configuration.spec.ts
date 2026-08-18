import {
  CONFIGURABLE_PROVIDERS,
  describeConfiguration,
  isConfigurableProvider,
  providerCatalogEntry,
} from './ai-configuration';

describe('catálogo de proveedores configurables', () => {
  it('solo se ofrece lo que cubre las DOS capacidades que el producto necesita', () => {
    // Vectorizar no es opcional: sin vectores, lo que la empresa sube no se puede preguntar.
    // Hoy solo OpenAI conversa y vectoriza, así que ofrecer otro obligaría a pedir dos claves
    // de dos proveedores distintos en los primeros diez minutos.
    expect(CONFIGURABLE_PROVIDERS.map((entry) => entry.provider)).toEqual([
      'OPENAI',
    ]);
  });

  it('RECHAZA un proveedor del enum que no está en el catálogo', () => {
    // El enum admite cinco; que exista en el modelo de datos no lo hace elegible.
    expect(isConfigurableProvider('ANTHROPIC')).toBe(false);
    expect(isConfigurableProvider('GEMINI')).toBe(false);
    expect(isConfigurableProvider('OPENAI')).toBe(true);
  });

  it('cada opción dice dónde conseguir la clave', () => {
    // Sin esto, una PYME se queda mirando un campo vacío sin saber qué pegar.
    for (const entry of CONFIGURABLE_PROVIDERS) {
      expect(entry.helpUrl).toMatch(/^https:\/\//);
      expect(entry.defaultModel.length).toBeGreaterThan(0);
      expect(providerCatalogEntry(entry.provider)).toEqual(entry);
    }
  });
});

describe('describeConfiguration', () => {
  it('con clave propia dice que la factura es de la empresa', () => {
    // Es la diferencia que a una PYME le importa: quién paga el consumo.
    const status = describeConfiguration({
      own: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', hasKey: true },
      platformAvailable: false,
    });

    expect(status).toMatchObject({
      origin: 'PROPIA',
      ready: true,
      hasOwnKey: true,
    });
    expect(status.explanation).toMatch(/tu cuenta/i);
  });

  it('sin configuración propia pero con plataforma, funciona y se DICE', () => {
    const status = describeConfiguration({
      own: null,
      platformAvailable: true,
      platformProvider: 'OPENAI',
      platformModel: 'gpt-4.1-mini',
    });

    expect(status).toMatchObject({
      origin: 'PLATAFORMA',
      ready: true,
      hasOwnKey: false,
    });
    // No se oculta que está usando la del servicio: quien lee tiene que poder decidir.
    expect(status.explanation).toMatch(/incluida en el servicio/i);
  });

  it('CRÍTICO: sin nada, NO se declara listo y se explica la consecuencia', () => {
    const status = describeConfiguration({
      own: null,
      platformAvailable: false,
    });

    expect(status.ready).toBe(false);
    expect(status.origin).toBe('SIN_CONFIGURAR');
    // La consecuencia en lenguaje de negocio, no "falta LlmProfile".
    expect(status.explanation).toMatch(/no puede leer tus documentos/i);
  });

  it('ningún estado menciona detalles técnicos', () => {
    // Requisito de producto: una PYME nunca debe leer nombres de columnas, clases ni
    // variables de entorno.
    const estados = [
      describeConfiguration({ own: null, platformAvailable: false }),
      describeConfiguration({ own: null, platformAvailable: true }),
      describeConfiguration({
        own: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', hasKey: true },
        platformAvailable: true,
      }),
    ];

    for (const estado of estados) {
      expect(estado.explanation).not.toMatch(
        /LlmProfile|apiKeyEnc|OPENAI_API_KEY|undefined|null|Exception/i,
      );
    }
  });
});
