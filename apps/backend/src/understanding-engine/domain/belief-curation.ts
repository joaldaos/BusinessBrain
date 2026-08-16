/**
 * Curación vigente de una creencia a lo largo de sus versiones — §3.7, §5. Fase 7.1.
 *
 * ## El problema que resuelve
 *
 * `InsightFeedback` cuelga de una FILA. Desde que una reconciliación crea una versión
 * sucesora (Fase 7), la creencia viva es una fila NUEVA sin curación, y el juicio de la
 * persona se quedaba con la versión superada: el decaimiento automático volvía a gobernar
 * algo que alguien había confirmado. §3.7 dice lo contrario — la curación tiene prioridad
 * sobre cualquier recálculo automático posterior **hasta que se revoca explícitamente**—, y
 * §15 la llama "pegajosa".
 *
 * ## La forma de resolverlo: proyección, no copia
 *
 * La curación NO se copia a la sucesora. Copiarla fabricaría un acto humano que no ocurrió:
 * la fila diría que esa persona se pronunció sobre una versión que nunca vio, y §3.7 exige
 * que el registro conserve al usuario que lo emitió y no se modifique jamás.
 *
 * En su lugar se RESUELVE al leer, recorriendo la cadena de supersesión hacia atrás. Es una
 * proyección viva no persistida, exactamente el mismo patrón que `EffectiveCollectionScope`
 * (§3.4) y `EvidenceFreshness` (§3.4): se calcula cuando se pregunta y nunca se guarda.
 *
 * ## Se entrega declarada, nunca disimulada
 *
 * Una curación heredada jamás se presenta indistinguible de una emitida sobre la versión
 * actual. Viaja con su origen, con la versión sobre la que la persona se pronunció y, si la
 * evidencia posterior la contradijo, marcada **en disputa**. Mismo principio que la frescura:
 * se entrega, no se oculta.
 *
 * Dominio puro: sin base de datos, sin red, determinista.
 */

/** Estados terminales que CORTAN la herencia. */
const DISCARDED = 'DISCARDED';

/**
 * Cota del recorrido hacia atrás.
 *
 * Una cadena más larga que esto es patológica, no un uso legítimo. Al alcanzarla se deja de
 * heredar en lugar de recorrer sin límite: es preferible que la persona vuelva a pronunciarse
 * a que una lectura quede colgada.
 */
export const MAX_CURATION_LOOKBACK = 50;

export interface CurationEntry {
  id: string;
  type: string;
  comment: string | null;
  createdAt: Date;
  /** Entrada que esta revocación deja sin efecto. */
  revokesFeedbackId: string | null;
}

/** Una versión de la cadena, con lo justo para resolver la curación. */
export interface CuratedVersion {
  id: string;
  status: string;
  supersedesInsightId: string | null;
  feedback: CurationEntry[];
  /**
   * Resultado de la reconciliación que produjo ESTA versión, si la hubo.
   *
   * `CONTRADICTED` significa que la evidencia nueva discrepa de lo que se afirmaba antes; si
   * la curación se hereda a través de una transición así, quien la emitió confirmó algo que
   * la evidencia posterior pone en duda.
   */
  reconciliationOutcome: string | null;
}

export type CurationOrigin =
  /** Emitida sobre esta misma versión. */
  | 'OWN'
  /** Emitida sobre una versión anterior de la misma creencia. */
  | 'INHERITED';

export interface EffectiveCuration {
  type: string;
  comment: string | null;
  at: Date;
  origin: CurationOrigin;
  /** Versión sobre la que la persona realmente se pronunció. */
  curatedVersionId: string;
  /**
   * La evidencia posterior contradice lo que se curó.
   *
   * Solo puede ser cierto en una curación heredada: una propia se emitió sobre la versión
   * actual, así que no hay nada posterior que la discuta.
   */
  disputed: boolean;
}

/**
 * Curación vigente de una versión concreta: la última entrada no revocada (§3.7).
 *
 * Solo mira las entradas de esa versión. No hereda.
 */
export function resolveOwnCuration(
  feedback: CurationEntry[],
): { type: string; comment: string | null; at: Date; id: string } | null {
  const revokedIds = new Set(
    feedback
      .map((entry) => entry.revokesFeedbackId)
      .filter((id): id is string => id !== null),
  );

  // Se recorre de más reciente a más antigua: la vigente es la primera que no ha sido
  // revocada y que no es ella misma una revocación.
  const ordered = [...feedback].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const current = ordered.find(
    (entry) => entry.type !== 'REVOCATION' && !revokedIds.has(entry.id),
  );

  return current
    ? {
        type: current.type,
        comment: current.comment,
        at: current.createdAt,
        id: current.id,
      }
    : null;
}

/**
 * Curación efectiva de una versión: la propia si existe, y si no la de la versión anterior
 * de la misma creencia.
 *
 * @param versionId  Versión que se está leyendo.
 * @param chain      Versiones de la creencia indexadas por identificador. No hace falta que
 *                   estén completas: lo que no venga corta la herencia, que es el lado seguro.
 */
export function resolveEffectiveCuration(
  versionId: string,
  chain: Map<string, CuratedVersion>,
): EffectiveCuration | null {
  const version = chain.get(versionId);
  if (!version) return null;

  const own = resolveOwnCuration(version.feedback);
  if (own) {
    return {
      type: own.type,
      comment: own.comment,
      at: own.at,
      origin: 'OWN',
      curatedVersionId: version.id,
      disputed: false,
    };
  }

  let current = version;
  let contradictedOnTheWay = false;

  for (let step = 0; step < MAX_CURATION_LOOKBACK; step += 1) {
    // La transición que produjo la versión en la que estamos ahora: si fue una
    // contradicción, cualquier curación heredada desde más atrás queda en disputa.
    if (current.reconciliationOutcome === 'CONTRADICTED') {
      contradictedOnTheWay = true;
    }

    const predecessorId = current.supersedesInsightId;
    if (predecessorId === null) return null;

    const predecessor = chain.get(predecessorId);
    if (!predecessor) return null;

    // Una curación NUNCA se hereda a través de un descarte humano. Si alguien descartó el
    // asunto y después apareció evidencia nueva, la creencia nueva nace sin curación: §12
    // dice que un descartado no bloquea permanentemente una observación legítima posterior,
    // y arrastrar el descarte hacia adelante sería justo eso.
    if (predecessor.status === DISCARDED) return null;

    const inherited = resolveOwnCuration(predecessor.feedback);
    if (inherited) {
      return {
        type: inherited.type,
        comment: inherited.comment,
        at: inherited.at,
        origin: 'INHERITED',
        curatedVersionId: predecessor.id,
        disputed: contradictedOnTheWay,
      };
    }

    current = predecessor;
  }

  // Cadena más larga que la cota: se deja de heredar en vez de seguir recorriendo.
  return null;
}

/**
 * ¿Autoriza esta curación a escalar a `Recommendation`?
 *
 * **Solo la propia.** Escalar redacta una propuesta formal de acción sobre una afirmación
 * concreta, y §11 exige aprobación explícita. Una curación heredada dice que alguien validó
 * una versión ANTERIOR de la creencia; tomarla como aprobación de la actual convertiría un
 * juicio sobre una afirmación en un juicio sobre otra distinta, que es exactamente lo que la
 * herencia declarada existe para hacer visible.
 *
 * Fail-closed: sin curación, o con una heredada, no se escala.
 */
export function authorizesEscalation(
  curation: EffectiveCuration | null,
): boolean {
  return curation !== null && curation.origin === 'OWN';
}
