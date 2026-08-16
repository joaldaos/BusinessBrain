import {
  REDACTED,
  diffForAudit,
  hasChanges,
  isSecretKey,
  redactAuditMetadata,
} from './audit-redaction';

/**
 * Subfase 6.2 — redacción y diferencias.
 *
 * La auditoría es el único almacén del sistema pensado para conservarse mucho tiempo,
 * consultarse en investigaciones y exportarse. Un secreto que entra aquí no rota nunca.
 */
describe('isSecretKey', () => {
  it.each([
    'apiKeyEnc',
    'api_key',
    'providerApiKey',
    'password',
    'passwordHash',
    'refreshToken',
    'clientSecret',
    'configEnc',
    'ENCRYPTION_KEY',
    'privateKey',
  ])('reconoce "%s" como secreto', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each(['name', 'status', 'organizationId', 'summary', 'tokensUsed'])(
    'no marca "%s" como secreto',
    (key) => {
      expect(isSecretKey(key)).toBe(false);
    },
  );

  it('compara sin distinguir mayúsculas: el nombre real de un campo varía', () => {
    expect(isSecretKey('APIKEYENC')).toBe(true);
    expect(isSecretKey('ApiKey')).toBe(true);
  });
});

describe('redactAuditMetadata', () => {
  it('redacta por NOMBRE de clave, sin mirar el valor', () => {
    const redacted = redactAuditMetadata({
      name: 'Agente comercial',
      apiKeyEnc: 'sk-ant-una-clave-real',
    }) as Record<string, unknown>;

    expect(redacted.name).toBe('Agente comercial');
    expect(redacted.apiKeyEnc).toBe(REDACTED);
  });

  it('redacta EN PROFUNDIDAD: los secretos viajan anidados', () => {
    const redacted = redactAuditMetadata({
      profile: { modelName: 'gpt-4.1', apiKeyEnc: 'sk-secreta' },
      sources: [{ name: 'Drive', configEnc: 'cifrado' }],
    }) as {
      profile: Record<string, unknown>;
      sources: Record<string, unknown>[];
    };

    expect(redacted.profile.modelName).toBe('gpt-4.1');
    expect(redacted.profile.apiKeyEnc).toBe(REDACTED);
    expect(redacted.sources[0].configEnc).toBe(REDACTED);
    expect(redacted.sources[0].name).toBe('Drive');
  });

  it('ninguna forma de secreto sobrevive al serializar', () => {
    const serialized = JSON.stringify(
      redactAuditMetadata({
        a: { b: { c: { apiKey: 'sk-profunda' } } },
        list: [{ password: 'hunter2' }],
      }),
    );

    expect(serialized).not.toContain('sk-profunda');
    expect(serialized).not.toContain('hunter2');
  });

  it('acota la profundidad: una estructura autorreferente no cuelga el registro', () => {
    const cyclic: Record<string, unknown> = { name: 'raíz' };
    cyclic.self = cyclic;

    expect(() => JSON.stringify(redactAuditMetadata(cyclic))).not.toThrow();
  });

  it('acota listas largas y deja constancia de lo omitido', () => {
    const redacted = redactAuditMetadata({
      ids: Array.from({ length: 120 }, (_, i) => `id-${i}`),
    }) as { ids: unknown[] };

    expect(redacted.ids).toHaveLength(51);
    expect(String(redacted.ids.at(-1))).toMatch(/70 elementos más/);
  });

  it('trunca textos desmesurados en vez de guardarlos enteros', () => {
    const redacted = redactAuditMetadata({
      comment: 'x'.repeat(5000),
    }) as { comment: string };

    expect(redacted.comment.length).toBeLessThan(5000);
    expect(redacted.comment).toMatch(/TRUNCADO/);
  });

  it('normaliza fechas para que el registro sea legible y comparable', () => {
    const redacted = redactAuditMetadata({
      at: new Date('2026-08-13T10:00:00.000Z'),
    }) as { at: string };

    expect(redacted.at).toBe('2026-08-13T10:00:00.000Z');
  });
});

describe('diffForAudit', () => {
  it('registra SOLO lo que cambió', () => {
    const changes = diffForAudit(
      { name: 'Antiguo', area: 'SALES', isActive: true },
      { name: 'Nuevo', area: 'SALES', isActive: true },
    );

    expect(changes).toEqual({
      before: { name: 'Antiguo' },
      after: { name: 'Nuevo' },
    });
  });

  it('`undefined` significa "no se tocó", no "se borró"', () => {
    // Las actualizaciones parciales llegan así; registrarlas como borrados sería mentir.
    const changes = diffForAudit(
      { name: 'Agente', area: 'SALES' },
      { name: undefined, area: 'FINANCE' },
    );

    expect(changes.after).toEqual({ area: 'FINANCE' });
    expect(changes.before).toEqual({ area: 'SALES' });
  });

  it('un cambio a nulo SÍ se registra: es un cambio real', () => {
    const changes = diffForAudit(
      { llmProfileId: 'p1' },
      { llmProfileId: null },
    );

    expect(changes.before).toEqual({ llmProfileId: 'p1' });
    expect(changes.after).toEqual({ llmProfileId: null });
  });

  it('compara objetos por valor, no por referencia', () => {
    const changes = diffForAudit(
      { tools: [{ tool: 'knowledge_search' }] },
      { tools: [{ tool: 'knowledge_search' }] },
    );

    expect(hasChanges(changes)).toBe(false);
  });

  it('detecta un cambio dentro de una estructura anidada', () => {
    const changes = diffForAudit(
      { memoryConfig: { strategy: 'none' } },
      { memoryConfig: { strategy: 'long_term' } },
    );

    expect(hasChanges(changes)).toBe(true);
    expect(changes.after.memoryConfig).toEqual({ strategy: 'long_term' });
  });

  it('un campo secreto que cambia se registra COMO cambio, nunca con el valor', () => {
    const changes = diffForAudit(
      { apiKeyEnc: 'clave-vieja' },
      { apiKeyEnc: 'clave-nueva' },
    );

    expect(changes.before.apiKeyEnc).toBe(REDACTED);
    expect(changes.after.apiKeyEnc).toBe(REDACTED);
    expect(JSON.stringify(changes)).not.toContain('clave-nueva');
  });

  it('una creación se expresa como diferencia contra la nada', () => {
    const changes = diffForAudit(null, { name: 'Nuevo agente' });

    expect(changes.before).toEqual({});
    expect(changes.after).toEqual({ name: 'Nuevo agente' });
  });

  it('sin cambios no hay nada que registrar', () => {
    expect(hasChanges(diffForAudit({ a: 1 }, { a: 1 }))).toBe(false);
    expect(hasChanges(diffForAudit(null, null))).toBe(false);
  });
});
