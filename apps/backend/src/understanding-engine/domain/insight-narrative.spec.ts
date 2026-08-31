import {
  narrarConclusion,
  SEÑALES_NARRABLES,
  type SeñalNarrable,
} from './insight-narrative';

/**
 * Cómo se le cuenta una conclusión a quien recibe el informe.
 *
 * Un PDF de BusinessBrain acaba en manos de una gestoría, de un gerente o de quien lleve las
 * operaciones de una PYME. Ninguno de los tres sabe —ni tiene por qué saber— qué es un umbral
 * de recuperación ni qué significa 0.64.
 *
 * Estas comprobaciones defienden las dos mitades de la regla:
 *
 * 1. El nivel principal se cuenta en lenguaje de negocio, sin números internos.
 * 2. **Cuando el sistema no sabe de qué va, no se inventa un titular.** Se entrega la frase
 *    del motor tal cual. En un documento que se reenvía por correo y que ya nadie vuelve a
 *    verificar, afirmar algo que no se ha comprobado es mucho peor que resultar árido.
 */

const traza = (
  señal: string,
  hechos: Record<string, unknown> = {},
): Record<string, unknown> => ({
  strategyKind: 'SYMBOLIC',
  signalKind: señal,
  facts: hechos,
});

const RESUMEN_DEL_MOTOR =
  'La confianza de "politica-descuentos.pdf" cayó a 0.64, por debajo del umbral 0.95 ' +
  'configurado por la organización. Dejó de ser recuperable por defecto.';

/** Lo que no puede aparecer en el nivel principal de un informe. */
const TECNICO =
  /\b(0[.,]\d+|umbral|recuperable|score|threshold|ANOMALY|PATTERN|confidence)\b/i;

describe('narrarConclusion', () => {
  it('cuenta un documento que ha perdido fiabilidad sin números ni umbrales', () => {
    const narrativa = narrarConclusion({
      summary: RESUMEN_DEL_MOTOR,
      reasoningTrace: traza('CONFIDENCE_DECAYED', {
        title: 'politica-descuentos.pdf',
        confidenceScore: 0.64,
        floor: 0.95,
      }),
    });

    expect(narrativa.titular).toContain('politica-descuentos.pdf');
    for (const linea of [
      narrativa.titular,
      narrativa.detectado,
      narrativa.porQueImporta,
      narrativa.queHacer,
    ]) {
      expect(linea).not.toMatch(TECNICO);
    }

    // Las cuatro preguntas, respondidas.
    expect(narrativa.detectado).toBeTruthy();
    expect(narrativa.porQueImporta).toBeTruthy();
    expect(narrativa.queHacer).toBeTruthy();
  });

  it('afirma el impacto de una fuente caída solo cuando lo conoce', () => {
    const conDato = narrarConclusion({
      summary: 'da igual',
      reasoningTrace: traza('SOURCE_DISCONNECTED', {
        name: 'Documentos de ventas',
        affectedKnowledgeItems: 7,
      }),
    });
    expect(conDato.porQueImporta).toContain('7');

    // Sin el dato no se dice nada: "cero documentos afectados" y "no lo sabemos" no son lo
    // mismo, y en un informe la diferencia importa.
    const sinDato = narrarConclusion({
      summary: 'da igual',
      reasoningTrace: traza('SOURCE_DISCONNECTED', {
        name: 'Documentos de ventas',
      }),
    });
    expect(sinDato.porQueImporta).toBeNull();
  });

  it('respeta lo que redactó el modelo sobre los documentos de la empresa', () => {
    const redactado =
      'Los descuentos aplicados superan el margen objetivo del 30 %.';
    const narrativa = narrarConclusion({
      summary: redactado,
      reasoningTrace: { strategyKind: 'GENERATIVE', modelReasoning: '…' },
    });

    expect(narrativa.titular).toBe(redactado);
    expect(narrativa.detectado).toBeNull();
  });

  it.each([
    ['sin traza', undefined],
    ['con traza nula', null],
    ['con una traza que no es un objeto', 'vaya'],
    ['con una señal desconocida', traza('ALGO_QUE_NO_EXISTE')],
    [
      'con la señal correcta pero sin el hecho que hace falta',
      traza('CONFIDENCE_DECAYED'),
    ],
    [
      'con un recuento imposible',
      traza('CANONICALIZATION_UNRESOLVED', { candidateCount: 0 }),
    ],
  ])(
    '%s, entrega el resumen del motor sin inventarse nada',
    (_caso, reasoningTrace) => {
      const narrativa = narrarConclusion({
        summary: RESUMEN_DEL_MOTOR,
        reasoningTrace,
      });

      expect(narrativa.titular).toBe(RESUMEN_DEL_MOTOR);
      expect(narrativa.detectado).toBeNull();
      expect(narrativa.porQueImporta).toBeNull();
      expect(narrativa.queHacer).toBeNull();
    },
  );

  /**
   * Si el Knowledge Engine expone una señal nueva y nadie la traduce, el informe la enseña en
   * el vocabulario del motor sin que salte ninguna alarma. Esta prueba es la alarma.
   */
  it('sabe contar TODAS las señales que declara saber contar', () => {
    const hechosPorSeñal: Record<SeñalNarrable, Record<string, unknown>> = {
      CONFIDENCE_DECAYED: { title: 'un-documento.pdf' },
      SOURCE_DISCONNECTED: { name: 'una fuente' },
      CANONICALIZATION_UNRESOLVED: { candidateCount: 3 },
    };

    for (const señal of SEÑALES_NARRABLES) {
      const narrativa = narrarConclusion({
        summary: RESUMEN_DEL_MOTOR,
        reasoningTrace: traza(señal, hechosPorSeñal[señal]),
      });

      expect(narrativa.titular).not.toBe(RESUMEN_DEL_MOTOR);
      expect(narrativa.titular).not.toMatch(TECNICO);
      expect(narrativa.queHacer).toBeTruthy();
    }
  });
});
