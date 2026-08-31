import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { useHallazgo } from './lenguaje';
import type { Insight } from '../api/types';

/**
 * Qué se le cuenta a una persona sobre una conclusión, y qué NO se inventa.
 *
 * Estas comprobaciones defienden las dos mitades de la misma regla. La primera: el resumen
 * que compone el motor —«la confianza cayó a 0.64, por debajo del umbral 0.95»— no puede ser
 * lo primero que se lee. La segunda, y más importante: cuando el sistema **no sabe** de qué
 * clase de hallazgo se trata, la pantalla enseña ese resumen tal cual en vez de redactar una
 * frase bonita que afirme algo que nadie ha comprobado.
 *
 * La segunda mitad es la que se rompe sola. Añadir un titular por defecto —«BusinessBrain ha
 * encontrado algo que revisar»— parece una mejora y es una mentira: se afirmaría que hay algo
 * que revisar sin saber qué señal lo produjo.
 */

const envoltorio = ({ children }: { children: ReactNode }) => (
  <I18nProvider preferred="es">{children}</I18nProvider>
);

const conclusion = (extra: Partial<Insight> = {}): Insight => ({
  id: 'i1',
  type: 'ANOMALY',
  summary:
    'La confianza de "politica-descuentos.pdf" cayó a 0.64, por debajo del umbral 0.95 configurado por la organización. Dejó de ser recuperable por defecto.',
  status: 'ACTIVE',
  confidence: 0.9,
  freshness: 'FRESH',
  freshnessRationale: '',
  strategyKey: 'knowledge-signal',
  evidence: [],
  businessObjectives: [],
  curation: null,
  createdAt: '2026-08-30T10:00:00.000Z',
  ...extra,
});

const hallazgoDe = (insight: Insight) =>
  renderHook(() => useHallazgo(), { wrapper: envoltorio }).result.current(insight);

describe('cómo se le cuenta una conclusión a una persona', () => {
  it('un documento que ha perdido fiabilidad se cuenta sin números ni umbrales', () => {
    const hallazgo = hallazgoDe(
      conclusion({
        reasoningTrace: {
          strategyKind: 'SYMBOLIC',
          signalKind: 'CONFIDENCE_DECAYED',
          facts: {
            title: 'politica-descuentos.pdf',
            confidenceScore: 0.64,
            floor: 0.95,
          },
        },
      }),
    );

    // Se nombra el documento, que es lo único que le importa a quien lo lee.
    expect(hallazgo.titular).toContain('politica-descuentos.pdf');
    // Y NO aparecen ni la puntuación ni el listón: son los datos con los que se detectó, no
    // lo que hay que hacer al respecto.
    expect(hallazgo.titular).not.toMatch(/0[.,]64|0[.,]95|umbral|confianza/i);
    expect(hallazgo.detectado).not.toMatch(/0[.,]64|0[.,]95|umbral/i);

    // Las tres preguntas, respondidas.
    expect(hallazgo.detectado).toBeTruthy();
    expect(hallazgo.porQueImporta).toBeTruthy();
    expect(hallazgo.accion?.a).toBe('/conocimiento');
  });

  it('una fuente caída dice a cuántos documentos afecta, y solo si lo sabe', () => {
    const conDato = hallazgoDe(
      conclusion({
        reasoningTrace: {
          strategyKind: 'SYMBOLIC',
          signalKind: 'SOURCE_DISCONNECTED',
          facts: { name: 'Documentos de ventas', affectedKnowledgeItems: 7 },
        },
      }),
    );
    expect(conDato.titular).toContain('Documentos de ventas');
    expect(conDato.porQueImporta).toContain('7');

    // Sin el dato NO se afirma un impacto: cero documentos afectados no es "afecta a cero",
    // es "no lo sabemos", y decir cualquiera de las dos cosas sería inventarlo.
    const sinDato = hallazgoDe(
      conclusion({
        reasoningTrace: {
          strategyKind: 'SYMBOLIC',
          signalKind: 'SOURCE_DISCONNECTED',
          facts: { name: 'Documentos de ventas' },
        },
      }),
    );
    expect(sinDato.porQueImporta).toBeNull();
  });

  it('lo que redactó el modelo sobre los documentos de la empresa se respeta tal cual', () => {
    const resumen = 'Los descuentos aplicados superan el margen objetivo del 30 %.';
    const hallazgo = hallazgoDe(
      conclusion({
        summary: resumen,
        reasoningTrace: { strategyKind: 'GENERATIVE' },
      }),
    );

    // Es contenido de la empresa, escrito ya en su idioma y sobre sus documentos: traducirlo
    // sería reescribir lo que la empresa ha comprendido.
    expect(hallazgo.titular).toBe(resumen);
    expect(hallazgo.detectado).toBeNull();
  });

  it('sin traza NO se inventa un titular: se enseña lo que dijo el sistema', () => {
    const original = conclusion({ reasoningTrace: null });
    expect(hallazgoDe(original).titular).toBe(original.summary);

    // Y con una señal que esta versión de la interfaz no conoce, lo mismo. Un texto feo es
    // mejor que un texto bonito que afirme algo que nadie ha comprobado.
    const desconocida = conclusion({
      reasoningTrace: { strategyKind: 'SYMBOLIC', signalKind: 'ALGO_NUEVO' },
    });
    expect(hallazgoDe(desconocida).titular).toBe(desconocida.summary);
  });

  it('con la traza incompleta tampoco se rellena el hueco', () => {
    // La señal dice de qué va, pero falta el nombre del documento. Sin él, el titular
    // quedaría como «« » ya no ofrece la seguridad…», que es peor que la frase del motor.
    const hallazgo = hallazgoDe(
      conclusion({
        reasoningTrace: {
          strategyKind: 'SYMBOLIC',
          signalKind: 'CONFIDENCE_DECAYED',
          facts: { confidenceScore: 0.64 },
        },
      }),
    );

    expect(hallazgo.titular).toContain('confianza');
    expect(hallazgo.detectado).toBeNull();
  });
});
