import { KnowledgeSourceType } from '@businessbrain/database';
import {
  DEFAULT_CANONICAL_WINNER_MARGIN,
  getCanonicalWinnerMargin,
  resolveCanonicalGroup,
} from './canonicalization';

/**
 * Criterio de aceptación de la subfase 2.5 (KNOWLEDGE_ENGINE_DESIGN.md §19):
 * "dos KnowledgeItem vinculados manualmente como candidatos se agrupan y se resuelven
 * (o se marcan en conflicto) según las reglas de §10".
 */
describe('resolveCanonicalGroup (§10)', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  const candidate = (
    id: string,
    confidenceScore: number,
    overrides: Partial<{
      sourceType: KnowledgeSourceType | null;
      indexedAt: Date;
    }> = {},
  ) => ({
    knowledgeItemId: id,
    confidenceScore,
    sourceType: overrides.sourceType ?? KnowledgeSourceType.FILE_UPLOAD,
    indexedAt: overrides.indexedAt ?? daysAgo(10),
  });

  const margin = DEFAULT_CANONICAL_WINNER_MARGIN;

  it('resuelve cuando hay ganador claro por encima del umbral', () => {
    const result = resolveCanonicalGroup({
      candidates: [candidate('a', 0.95), candidate('b', 0.3)],
      winnerMargin: margin,
      now,
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.winnerKnowledgeItemId).toBe('a');
    expect(result.margin).toBeGreaterThanOrEqual(margin);
  });

  it('NO resuelve ante diferencia insuficiente: queda en conflicto (§10)', () => {
    const result = resolveCanonicalGroup({
      candidates: [candidate('a', 0.8), candidate('b', 0.78)],
      winnerMargin: margin,
      now,
    });

    expect(result.status).toBe('IN_CONFLICT');
    expect(result.rationale).toMatch(/revisión humana/i);
  });

  it('NO resuelve ante empate exacto', () => {
    const result = resolveCanonicalGroup({
      candidates: [candidate('a', 0.8), candidate('b', 0.8)],
      winnerMargin: margin,
      now,
    });

    expect(result.status).toBe('IN_CONFLICT');
    expect(result.margin).toBe(0);
  });

  it('un candidato único se resuelve sin conflicto', () => {
    const result = resolveCanonicalGroup({
      candidates: [candidate('a', 0.5)],
      winnerMargin: margin,
      now,
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.winnerKnowledgeItemId).toBe('a');
    expect(result.margin).toBeNull();
  });

  it('un grupo sin candidatos activos no designa ganador', () => {
    const result = resolveCanonicalGroup({
      candidates: [],
      winnerMargin: margin,
      now,
    });

    expect(result.status).toBe('IN_CONFLICT');
    expect(result.winnerKnowledgeItemId).toBeNull();
  });

  it('la recencia desempata en igualdad de confianza y fuente (§10)', () => {
    const result = resolveCanonicalGroup({
      candidates: [
        candidate('viejo', 0.9, { indexedAt: daysAgo(300) }),
        candidate('nuevo', 0.9, { indexedAt: daysAgo(1) }),
      ],
      winnerMargin: 0.05,
      now,
    });

    expect(result.ranking[0].knowledgeItemId).toBe('nuevo');
  });

  it('la confianza base de la fuente pesa en el ranking (§10)', () => {
    const result = resolveCanonicalGroup({
      candidates: [
        candidate('web', 0.8, { sourceType: KnowledgeSourceType.SOCIAL_MEDIA }),
        candidate('erp', 0.8, { sourceType: KnowledgeSourceType.ERP }),
      ],
      winnerMargin: 0.05,
      now,
    });

    expect(result.ranking[0].knowledgeItemId).toBe('erp');
  });

  it('una fuente nueva de baja confianza NO desplaza al canónico establecido (§10)', () => {
    // "Esto evita que una fuente de baja confianza recién conectada desplace conocimiento
    // bien establecido solo por ser más reciente."
    const result = resolveCanonicalGroup({
      candidates: [
        candidate('establecido', 0.9, { indexedAt: daysAgo(200) }),
        candidate('recien-llegado', 0.82, { indexedAt: daysAgo(0) }),
      ],
      winnerMargin: margin,
      now,
      currentWinnerId: 'establecido',
    });

    expect(result.status).toBe('IN_CONFLICT');
    // El canónico anterior se conserva: un empate no deja al grupo sin versión oficial.
    expect(result.winnerKnowledgeItemId).toBe('establecido');
  });

  it('expone el ranking completo y el porqué: la decisión es explicable', () => {
    const result = resolveCanonicalGroup({
      candidates: [candidate('a', 0.95), candidate('b', 0.3)],
      winnerMargin: margin,
      now,
    });

    expect(result.ranking).toHaveLength(2);
    expect(result.rationale.length).toBeGreaterThan(0);
    for (const entry of result.ranking) {
      expect(entry.factors).toEqual({
        currentConfidence: expect.any(Number),
        sourceTrust: expect.any(Number),
        recency: expect.any(Number),
      });
    }
  });

  it('es determinista, incluso ante scores idénticos', () => {
    const input = {
      candidates: [candidate('b', 0.8), candidate('a', 0.8)],
      winnerMargin: margin,
      now,
    };

    const first = resolveCanonicalGroup(input);
    const second = resolveCanonicalGroup(input);

    expect(first).toEqual(second);
    // Desempate estable por id, para que el orden no dependa del de entrada.
    expect(first.ranking[0].knowledgeItemId).toBe('a');
  });
});

describe('getCanonicalWinnerMargin (§10, umbrales como configuración)', () => {
  it('usa el valor de plataforma si la organización no configura nada', () => {
    expect(getCanonicalWinnerMargin(null)).toBe(
      DEFAULT_CANONICAL_WINNER_MARGIN,
    );
  });

  it('respeta el umbral configurado por la organización', () => {
    expect(
      getCanonicalWinnerMargin({
        knowledgeEngine: { canonicalization: { winnerMargin: 0.4 } },
      }),
    ).toBe(0.4);
  });

  it('ignora un umbral inválido', () => {
    expect(
      getCanonicalWinnerMargin({
        knowledgeEngine: { canonicalization: { winnerMargin: 3 } },
      }),
    ).toBe(DEFAULT_CANONICAL_WINNER_MARGIN);
  });
});
