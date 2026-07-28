import {
  DEFAULT_MAX_CHUNKS_PER_ITEM,
  PLATFORM_MINIMUM_CONFIDENCE,
  combineSimilarity,
  enforceDiversity,
  lexicalOverlap,
  rankCandidates,
  resolveConfidenceFloor,
  type RetrievalCandidate,
} from './retrieval-ranking';

const now = new Date('2026-06-01T00:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const candidate = (
  id: string,
  overrides: Partial<RetrievalCandidate> = {},
): RetrievalCandidate => ({
  chunkId: id,
  knowledgeItemId: overrides.knowledgeItemId ?? `item-${id}`,
  content: overrides.content ?? 'contenido de prueba',
  chunkIndex: 0,
  metadata: {},
  knowledgeItemTitle: 'Doc',
  vectorDistance: overrides.vectorDistance ?? 0.2,
  lexicalScore: overrides.lexicalScore ?? 0,
  confidenceScore: overrides.confidenceScore ?? 0.8,
  indexedAt: overrides.indexedAt ?? daysAgo(10),
});

describe('rankCandidates (§13, paso 7)', () => {
  it('ordena por score descendente', () => {
    const ranked = rankCandidates(
      [
        candidate('lejano', { vectorDistance: 0.9 }),
        candidate('cercano', { vectorDistance: 0.05 }),
      ],
      now,
    );

    expect(ranked[0].chunkId).toBe('cercano');
  });

  it('ninguno de los tres factores domina por sí solo', () => {
    // Un fragmento algo menos similar pero mucho más confiable y reciente puede ganar.
    const ranked = rankCandidates(
      [
        candidate('similar-pero-dudoso', {
          vectorDistance: 0.1,
          confidenceScore: 0.25,
          indexedAt: daysAgo(360),
        }),
        candidate('confiable-y-reciente', {
          vectorDistance: 0.3,
          confidenceScore: 0.98,
          indexedAt: daysAgo(1),
        }),
      ],
      now,
    );

    expect(ranked[0].chunkId).toBe('confiable-y-reciente');
  });

  it('la confianza actúa como factor de ranking, no como filtro binario (§8.5)', () => {
    const ranked = rankCandidates(
      [
        candidate('baja-confianza', { confidenceScore: 0.3 }),
        candidate('alta-confianza', { confidenceScore: 0.95 }),
      ],
      now,
    );

    // El de baja confianza sigue presente: no se descarta, se rankea por debajo.
    expect(ranked).toHaveLength(2);
    expect(ranked[0].chunkId).toBe('alta-confianza');
  });

  it('expone los factores: el ranking es explicable', () => {
    const [result] = rankCandidates([candidate('a')], now);

    expect(result.factors).toEqual({
      similarity: expect.any(Number),
      confidence: expect.any(Number),
      recency: expect.any(Number),
    });
  });

  it('es determinista incluso ante scores idénticos', () => {
    const input = [candidate('b'), candidate('a')];
    const first = rankCandidates(input, now);
    const second = rankCandidates(input, now);

    expect(first).toEqual(second);
    expect(first[0].chunkId).toBe('a');
  });
});

describe('combineSimilarity (§13, paso 2: recuperación híbrida)', () => {
  it('la coincidencia léxica aporta precisión que la vectorial diluye', () => {
    // Mismo vecindario semántico, pero uno contiene el término exacto (un código, un nombre).
    const sinLexico = combineSimilarity(0.3, 0);
    const conLexico = combineSimilarity(0.3, 1);

    expect(conLexico).toBeGreaterThan(sinLexico);
  });

  it('una distancia mayor produce menor similitud', () => {
    expect(combineSimilarity(0.1, 0)).toBeGreaterThan(
      combineSimilarity(0.8, 0),
    );
  });

  it('nunca produce una similitud negativa', () => {
    expect(combineSimilarity(1.9, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('enforceDiversity (§13, paso 8)', () => {
  it('limita cuántos fragmentos del mismo documento aparecen', () => {
    const ranked = rankCandidates(
      Array.from({ length: 6 }, (_, i) =>
        candidate(`c${i}`, { knowledgeItemId: 'mismo-doc' }),
      ),
      now,
    );

    expect(enforceDiversity(ranked, 2)).toHaveLength(2);
  });

  it('no monopoliza el contexto: deja sitio a otras fuentes', () => {
    const ranked = rankCandidates(
      [
        candidate('a1', { knowledgeItemId: 'doc-a', vectorDistance: 0.01 }),
        candidate('a2', { knowledgeItemId: 'doc-a', vectorDistance: 0.02 }),
        candidate('a3', { knowledgeItemId: 'doc-a', vectorDistance: 0.03 }),
        candidate('b1', { knowledgeItemId: 'doc-b', vectorDistance: 0.5 }),
      ],
      now,
    );

    const diverse = enforceDiversity(ranked, 2);
    expect(diverse.map((d) => d.knowledgeItemId)).toContain('doc-b');
  });

  it('conserva el orden de ranking dentro del límite', () => {
    const ranked = rankCandidates(
      [
        candidate('lejos', { vectorDistance: 0.7 }),
        candidate('cerca', { vectorDistance: 0.05 }),
      ],
      now,
    );

    expect(
      enforceDiversity(ranked, DEFAULT_MAX_CHUNKS_PER_ITEM)[0].chunkId,
    ).toBe('cerca');
  });
});

describe('resolveConfidenceFloor (§8.5, piso no desactivable)', () => {
  it('aplica el piso de plataforma por defecto', () => {
    expect(resolveConfidenceFloor()).toBe(PLATFORM_MINIMUM_CONFIDENCE);
  });

  it('un consumidor puede ENDURECER el piso', () => {
    expect(resolveConfidenceFloor(0.7)).toBe(0.7);
  });

  it('NUNCA puede relajarlo por debajo del mínimo de plataforma', () => {
    expect(resolveConfidenceFloor(0)).toBe(PLATFORM_MINIMUM_CONFIDENCE);
    expect(resolveConfidenceFloor(-1)).toBe(PLATFORM_MINIMUM_CONFIDENCE);
    expect(resolveConfidenceFloor(0.05)).toBe(PLATFORM_MINIMUM_CONFIDENCE);
  });
});

describe('lexicalOverlap (§13, paso 2)', () => {
  it('detecta términos exactos como códigos o nombres propios', () => {
    expect(
      lexicalOverlap('factura ACME-2026', 'La factura ACME-2026 vence hoy'),
    ).toBe(1);
  });

  it('devuelve 0 si no hay coincidencia', () => {
    expect(lexicalOverlap('vacaciones', 'política de gastos')).toBe(0);
  });

  it('ignora términos demasiado cortos para ser discriminantes', () => {
    expect(lexicalOverlap('de la el', 'cualquier contenido')).toBe(0);
  });
});
