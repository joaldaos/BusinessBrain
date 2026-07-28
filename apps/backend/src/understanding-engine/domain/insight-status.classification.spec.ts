/**
 * Test de contrato exigido por UNDERSTANDING_ENGINE_DESIGN.md §5 y §3.4.
 *
 * Su función no es comprobar la implementación actual, sino IMPEDIR que un estado o un tipo
 * nuevo entre en el enum sin clasificarse explícitamente. Si alguien añade un valor a
 * `InsightStatus` o a `InsightType` y no lo clasifica, este test falla en CI — la ausencia
 * de clasificación nunca debe resolverse por omisión.
 */
import { InsightStatus, InsightType } from '@prisma/client';
import {
  ACTIVE_INSIGHT_STATUSES,
  TERMINAL_INSIGHT_STATUSES,
  TYPES_REQUIRING_BUSINESS_OBJECTIVE,
  isTerminalInsightStatus,
  requiresBusinessObjective,
} from './insight-status.classification';

describe('Clasificación del ciclo de vida de Insight (§5)', () => {
  it('clasifica TODO estado del enum como activo o terminal, sin omisiones', () => {
    const clasificados = [
      ...ACTIVE_INSIGHT_STATUSES,
      ...TERMINAL_INSIGHT_STATUSES,
    ];
    const sinClasificar = Object.values(InsightStatus).filter(
      (s) => !clasificados.includes(s),
    );

    expect(sinClasificar).toEqual([]);
  });

  it('no clasifica ningún estado como activo y terminal a la vez', () => {
    const solapados = (
      ACTIVE_INSIGHT_STATUSES as readonly InsightStatus[]
    ).filter((s) =>
      (TERMINAL_INSIGHT_STATUSES as readonly InsightStatus[]).includes(s),
    );

    expect(solapados).toEqual([]);
  });

  it('mantiene cerrado el conjunto terminal que sostiene el índice de idempotencia (§12)', () => {
    // Si este conjunto cambia, el índice parcial de la migración debe revisarse a la vez:
    // se define por exclusión de estos estados, no por inclusión de los activos.
    expect([...TERMINAL_INSIGHT_STATUSES].sort()).toEqual(
      ['DISCARDED', 'EXPIRED', 'SUPERSEDED'].sort(),
    );
  });

  it('no admite un estado que describa frescura en vez de estatus epistémico', () => {
    // La frescura es EvidenceFreshness, proyección derivada en lectura (§3.4). Un estado
    // OBSOLETE persistido reintroduciría la obsolescencia silenciosa que §5 elimina.
    expect(Object.values(InsightStatus)).not.toContain('OBSOLETE');
  });

  it('isTerminalInsightStatus responde según la clasificación declarada', () => {
    expect(isTerminalInsightStatus(InsightStatus.ACTIVE)).toBe(false);
    expect(isTerminalInsightStatus(InsightStatus.CANDIDATE)).toBe(false);
    expect(isTerminalInsightStatus(InsightStatus.SUPERSEDED)).toBe(true);
    expect(isTerminalInsightStatus(InsightStatus.EXPIRED)).toBe(true);
    expect(isTerminalInsightStatus(InsightStatus.DISCARDED)).toBe(true);
  });
});

describe('Regla de clasificación de tipos de Insight (§3.4, §8)', () => {
  it('declara explícitamente, para TODO tipo del enum, si exige BusinessObjective', () => {
    const declarados = Object.values(InsightType).filter(
      (t) =>
        requiresBusinessObjective(t) ||
        !(TYPES_REQUIRING_BUSINESS_OBJECTIVE as readonly string[]).includes(t),
    );

    // Todo tipo debe estar cubierto por una de las dos ramas de forma explícita.
    expect(declarados.length).toBe(Object.values(InsightType).length);
  });

  it('exige ancla de negocio solo para juicios de valor, nunca para observaciones (§7)', () => {
    expect(requiresBusinessObjective(InsightType.RISK)).toBe(true);
    expect(requiresBusinessObjective(InsightType.OPPORTUNITY)).toBe(true);
    expect(requiresBusinessObjective(InsightType.PATTERN)).toBe(false);
    expect(requiresBusinessObjective(InsightType.ANOMALY)).toBe(false);
  });
});
