/**
 * El vocabulario interno, dicho en castellano.
 *
 * El backend habla con constantes —`INDEXED`, `ANOMALY`, `SUPERSEDED`, `OWNER`— porque un
 * catálogo cerrado en un idioma es lo correcto para un modelo de datos. Pero pintarlas tal cual
 * pone en la pantalla de una panadería palabras que no significan nada, en un idioma que
 * además no es el suyo.
 *
 * Vive en un solo sitio para que la traducción no derive: con `INDEXED` traducido en tres
 * pantallas distintas, la cuarta acaba enseñando la constante.
 *
 * Cuando llega un valor que no está en el catálogo se devuelve tal cual en vez de romper: es
 * preferible una palabra rara a una pantalla en blanco, y así una constante nueva se nota.
 */

function translate(
  vocabulary: Record<string, string>,
  value: string | null | undefined,
): string {
  if (!value) return '—';
  return vocabulary[value] ?? value;
}

/** Estado de un documento dentro del motor de conocimiento. */
export function knowledgeItemStatusLabel(value: string | null): string {
  return translate(
    {
      PENDING: 'en cola',
      PROCESSING: 'procesando',
      INDEXED: 'listo',
      FAILED: 'con problemas',
      SUPERSEDED: 'versión anterior',
      DELETED: 'eliminado',
    },
    value,
  );
}

/** Qué clase de conclusión es. */
export function insightTypeLabel(value: string | null): string {
  return translate(
    {
      PATTERN: 'patrón',
      ANOMALY: 'desviación',
      RISK: 'riesgo',
      OPPORTUNITY: 'oportunidad',
    },
    value,
  );
}

/**
 * Si una conclusión sigue siendo comprobable.
 *
 * No es "está mal": es si su evidencia sigue estando donde estaba. Por eso se dice con esas
 * palabras y no con un estado de validez.
 */
export function freshnessLabel(value: string | null): string {
  return translate(
    {
      FRESH: 'al día',
      STALE: 'ha cambiado desde que se calculó',
      UNRESOLVABLE: 'ya no se puede comprobar',
    },
    value,
  );
}

/** Resultado de una ejecución: análisis, sincronización, informe o automatización. */
export function runStatusLabel(value: string | null): string {
  return translate(
    {
      PENDING: 'en cola',
      RUNNING: 'en curso',
      SUCCESS: 'correcto',
      FAILED: 'con errores',
      PARTIAL: 'parcial',
      CANCELLED: 'cancelado',
    },
    value,
  );
}

/** Estado de una fuente o de una conexión externa. */
export function connectionStatusLabel(value: string | null): string {
  return translate(
    {
      PENDING: 'sin sincronizar',
      CONNECTED: 'conectada',
      SYNCING: 'sincronizando',
      ERROR: 'con problemas',
      DISABLED: 'desconectada',
    },
    value,
  );
}

/** Qué puede hacer una persona dentro de la empresa. */
export function roleLabel(value: string | null): string {
  return translate(
    {
      OWNER: 'propietario',
      ADMIN: 'administrador',
      MEMBER: 'miembro',
      VIEWER: 'solo lectura',
    },
    value,
  );
}

/** Estado de una automatización. */
export function automationStatusLabel(value: string | null): string {
  return translate(
    { ACTIVE: 'activa', PAUSED: 'pausada', ERROR: 'con problemas' },
    value,
  );
}
