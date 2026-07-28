import { InsightType } from '@businessbrain/database';
import { applyRiskOpportunityGate } from './risk-opportunity-gate';

/**
 * Criterio de aceptación de la subfase 3.2 (UNDERSTANDING_ENGINE_DESIGN.md §17):
 * "un candidato RISK sin BusinessObjective CONFIRMADO vinculado se degrada automáticamente
 * al tipo declarado por la propia ReasoningStrategy, nunca a un tipo decidido por el gate;
 * y, en el caso positivo, un candidato con BusinessObjective CONFIRMADO persiste como
 * RISK/OPPORTUNITY con su InsightObjectiveLink creado correctamente".
 */
describe('applyRiskOpportunityGate (§8)', () => {
  describe('sin ancla de negocio', () => {
    it('degrada un RISK al tipo que declaró la estrategia', () => {
      const decision = applyRiskOpportunityGate({
        type: InsightType.RISK,
        degradesTo: InsightType.ANOMALY,
        confirmedObjectiveIds: [],
      });

      expect(decision.resolvedType).toBe(InsightType.ANOMALY);
      expect(decision.degraded).toBe(true);
      expect(decision.objectiveIdsToLink).toEqual([]);
    });

    it('degrada un OPPORTUNITY al tipo que declaró la estrategia', () => {
      const decision = applyRiskOpportunityGate({
        type: InsightType.OPPORTUNITY,
        degradesTo: InsightType.PATTERN,
        confirmedObjectiveIds: [],
      });

      expect(decision.resolvedType).toBe(InsightType.PATTERN);
      expect(decision.degraded).toBe(true);
    });

    it('el gate NUNCA elige el tipo de degradación por su cuenta', () => {
      // Sin declaración, rechaza el candidato de forma explícita en vez de inventar una
      // decisión semántica que no le corresponde.
      expect(() =>
        applyRiskOpportunityGate({
          type: InsightType.RISK,
          confirmedObjectiveIds: [],
        }),
      ).toThrow(/tipo de degradación/i);
    });

    it('no descarta la información: la despoja del juicio que no puede justificar', () => {
      const decision = applyRiskOpportunityGate({
        type: InsightType.RISK,
        degradesTo: InsightType.ANOMALY,
        confirmedObjectiveIds: [],
      });

      // El candidato sobrevive como observación; lo que desaparece es el juicio de valor.
      expect(decision.resolvedType).toBeDefined();
      expect(decision.rationale).toMatch(/no se descarta/i);
    });
  });

  describe('con ancla de negocio confirmada', () => {
    it('un RISK persiste como RISK y devuelve los objetivos a vincular', () => {
      const decision = applyRiskOpportunityGate({
        type: InsightType.RISK,
        degradesTo: InsightType.ANOMALY,
        confirmedObjectiveIds: ['obj-1'],
      });

      expect(decision.resolvedType).toBe(InsightType.RISK);
      expect(decision.degraded).toBe(false);
      expect(decision.objectiveIdsToLink).toEqual(['obj-1']);
    });

    it('vincula todos los objetivos que hacen relevante el hallazgo (§3.8)', () => {
      const decision = applyRiskOpportunityGate({
        type: InsightType.OPPORTUNITY,
        degradesTo: InsightType.PATTERN,
        confirmedObjectiveIds: ['obj-1', 'obj-2', 'obj-3'],
      });

      expect(decision.objectiveIdsToLink).toHaveLength(3);
    });
  });

  describe('tipos sin juicio de valor (§7)', () => {
    it('un PATTERN pasa sin evaluación y sin ancla', () => {
      const decision = applyRiskOpportunityGate({
        type: InsightType.PATTERN,
        confirmedObjectiveIds: [],
      });

      expect(decision.resolvedType).toBe(InsightType.PATTERN);
      expect(decision.degraded).toBe(false);
      expect(decision.objectiveIdsToLink).toEqual([]);
    });

    it('un ANOMALY pasa sin evaluación aunque existan objetivos confirmados', () => {
      const decision = applyRiskOpportunityGate({
        type: InsightType.ANOMALY,
        confirmedObjectiveIds: ['obj-1'],
      });

      expect(decision.resolvedType).toBe(InsightType.ANOMALY);
      // Una observación no se ancla a un objetivo solo porque exista uno.
      expect(decision.objectiveIdsToLink).toEqual([]);
    });
  });

  it('la decisión es explicable: siempre expone su porqué (§10)', () => {
    const decisions = [
      applyRiskOpportunityGate({
        type: InsightType.PATTERN,
        confirmedObjectiveIds: [],
      }),
      applyRiskOpportunityGate({
        type: InsightType.RISK,
        degradesTo: InsightType.ANOMALY,
        confirmedObjectiveIds: [],
      }),
      applyRiskOpportunityGate({
        type: InsightType.RISK,
        degradesTo: InsightType.ANOMALY,
        confirmedObjectiveIds: ['obj-1'],
      }),
    ];

    for (const decision of decisions) {
      expect(decision.rationale.length).toBeGreaterThan(0);
    }
  });

  it('es determinista: la misma entrada produce la misma decisión', () => {
    const input = {
      type: InsightType.RISK,
      degradesTo: InsightType.ANOMALY,
      confirmedObjectiveIds: ['obj-1'],
    };

    expect(applyRiskOpportunityGate(input)).toEqual(
      applyRiskOpportunityGate(input),
    );
  });
});
