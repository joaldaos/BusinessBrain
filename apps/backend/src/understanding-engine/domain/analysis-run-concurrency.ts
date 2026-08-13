/**
 * Admisión del disparo MANUAL de análisis — subfase 6.1.
 *
 * **Esto NO es un invariante de dominio.** `UNDERSTANDING_ENGINE_DESIGN.md` §3.1 y §20
 * rechazan explícitamente serializar los `AnalysisRun` por organización: varias ejecuciones
 * simultáneas son legítimas —el barrido periódico y el disparo por evento se solapan por
 * diseño— y la corrección la garantizan la unicidad de identidad de sujeto por exclusión de
 * estados terminales y `ResolveInsightConflict`, nunca un cerrojo. Este módulo describe un
 * **control operativo de coste**, que es exactamente el lugar donde §3.1 lo admite, y solo lo
 * consume la superficie de disparo manual (`ManualTriggerAdmissionService`).
 *
 * El motivo del control: lanzar un análisis por HTTP cuesta tres recuperaciones vectoriales y
 * tres llamadas al modelo **contra la clave del propio cliente**, y dura decenas de segundos,
 * así que un doble clic o el reintento automático del proxy duplican la factura sin producir
 * más comprensión.
 *
 * La regla del control es: **un solo disparo MANUAL no terminal por organización**. Ningún
 * disparo automático la atraviesa.
 *
 * Pero un fail-closed puro sería peor que el problema. Si el proceso muere a mitad de una
 * ejecución, la fila queda en `RUNNING` para siempre y bloquea TODAS las futuras: el control
 * de concurrencia se convertiría en una denegación de servicio contra uno mismo, y la única
 * salida sería tocar la base de datos a mano. Por eso una ejecución `RUNNING` que lleva
 * demasiado tiempo se considera **abandonada**: no bloquea, se cierra como fallida y deja
 * paso.
 *
 * Dominio puro: sin base de datos, sin reloj propio, determinista. El instante actual entra
 * como parámetro para que la decisión sea reproducible en un test.
 */

/**
 * A partir de cuánto tiempo una ejecución `RUNNING` se considera abandonada.
 *
 * Se calibra sobre el coste real de una ejecución (3 probes, cada uno con recuperación
 * vectorial y una llamada al modelo), con margen amplio: el error caro aquí es declarar
 * abandonada una ejecución que sigue viva, porque entonces habría dos corriendo a la vez —
 * exactamente lo que este módulo existe para impedir.
 */
export const ABANDONED_RUN_THRESHOLD_MS = 15 * 60 * 1000;

export type AnalysisRunAdmission =
  /** No hay ninguna ejecución en curso: adelante. */
  | { decision: 'START' }
  /** Hay una viva. Se rechaza sin tocar nada. */
  | { decision: 'REJECT'; blockingRunId: string; startedAt: Date | null }
  /** Hay una abandonada: se cierra como fallida y se arranca la nueva. */
  | { decision: 'RECLAIM'; abandonedRunId: string };

export interface InFlightRun {
  id: string;
  startedAt: Date | null;
  createdAt: Date;
}

/**
 * Decide si una organización puede lanzar una ejecución nueva.
 *
 * `inFlight` es la ejecución no terminal más reciente, si la hay. Que la consulta la traiga
 * o no es responsabilidad de quien llama; aquí solo se decide.
 */
export function admitAnalysisRun(params: {
  inFlight: InFlightRun | null;
  now: Date;
  thresholdMs?: number;
}): AnalysisRunAdmission {
  const { inFlight, now } = params;
  if (!inFlight) return { decision: 'START' };

  const threshold = params.thresholdMs ?? ABANDONED_RUN_THRESHOLD_MS;

  // `startedAt` puede ser nulo si la fila se creó pero nunca llegó a arrancar. En ese caso
  // manda `createdAt`: lo que se mide es cuánto lleva ocupando el hueco, no cuánto lleva
  // trabajando.
  const since = (inFlight.startedAt ?? inFlight.createdAt).getTime();
  const elapsed = now.getTime() - since;

  // Estrictamente mayor: en el instante exacto del umbral la ejecución todavía se respeta.
  // Ante la duda se protege a la que ya está corriendo, porque el error caro es duplicar.
  if (elapsed > threshold) {
    return { decision: 'RECLAIM', abandonedRunId: inFlight.id };
  }

  return {
    decision: 'REJECT',
    blockingRunId: inFlight.id,
    startedAt: inFlight.startedAt,
  };
}

/** Explicación para el 409, con el tiempo que lleva la ejecución que bloquea. */
export function blockedRunExplanation(
  blockingRunId: string,
  startedAt: Date | null,
): string {
  const desde = startedAt
    ? ` (en curso desde ${startedAt.toISOString()})`
    : ' (aún sin arrancar)';

  return (
    `Ya hay un análisis en curso en esta organización: ${blockingRunId}${desde}. ` +
    'Espera a que termine antes de lanzar otro: dos análisis simultáneos duplicarían el ' +
    'coste sin producir más comprensión.'
  );
}
