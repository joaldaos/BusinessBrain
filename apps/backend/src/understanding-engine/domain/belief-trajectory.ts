/**
 * Trayectoria de una creencia — UNDERSTANDING_ENGINE_DESIGN.md §3.4, §5, §186. Fase 7.
 *
 * Responde la pregunta que hasta ahora el modelo no podía responder: **qué creíamos antes,
 * qué creemos ahora, y exactamente qué evidencia lo movió**.
 *
 * ## El orden lo da la CADENA, nunca el reloj
 *
 * Dos versiones pueden nacer en el mismo milisegundo, y dos procesos pueden tener relojes
 * desfasados. Ordenar por `createdAt` produciría historias distintas según quién las lea.
 * La relación de supersesión es la única fuente de orden: cada versión declara a cuál
 * reemplaza, y esa arista no depende de ningún reloj. `createdAt` es informativo.
 *
 * ## Ejes ortogonales (§186)
 *
 * El linaje de supersesión NUNCA se recorre junto con el grafo de evidencia. Un recorrido
 * que mezclara ambos tipos de arista podría fabricar ciclos aparentes entre entidades que
 * en realidad son una versión y su sucesora. Aquí solo se recorre supersesión.
 *
 * ## No se recorre evidencia al leer (§185)
 *
 * La atribución compara los `TransitiveEvidenceClosure` —conjuntos PLANOS ya materializados
 * e inmutables (§150)— de dos versiones consecutivas. No hay recursión ni acceso al grafo.
 *
 * Dominio puro: sin base de datos, sin red, determinista.
 */

/** Una referencia dentro de un cierre transitivo de evidencia. */
export interface EvidenceRef {
  kind: string;
  refId: string;
}

/** Versión de una creencia, tal como se necesita para reconstruir su trayectoria. */
export interface BeliefVersionInput {
  id: string;
  /** A qué versión reemplaza. `null` en la primera de la cadena. */
  supersedesInsightId: string | null;
  confidence: number;
  status: string;
  createdAt: Date;
  analysisRunId: string;
  transitiveEvidenceClosure: EvidenceRef[];
  /** refIds cuyo rol en ESTA versión es de contradicción. */
  contradictingRefIds: string[];
}

export type EvidenceChangeKind =
  /** Entró evidencia que antes no sostenía la creencia. */
  | 'ENTERED'
  /** Dejó de sostenerla: el razonamiento nuevo ya no descansa en ella. */
  | 'LEFT'
  /** Sigue presente, pero la fuente que la respalda fue versionada desde entonces. */
  | 'SUPERSEDED_EVIDENCE'
  /** Presente en la versión nueva con rol de contradicción. */
  | 'CONTRADICTED';

export interface EvidenceChange {
  kind: EvidenceChangeKind;
  ref: EvidenceRef;
}

export interface BeliefTransition {
  fromVersionId: string;
  toVersionId: string;
  previousConfidence: number;
  newConfidence: number;
  /** Positivo si la creencia se reforzó, negativo si se debilitó. */
  confidenceDelta: number;
  /** Cambios de evidencia VISIBLES para quien lee. */
  changes: EvidenceChange[];
  /**
   * Cambios que existen pero caen fuera del alcance del lector.
   *
   * Se informa el RECUENTO, jamás el identificador: sin este recuento la historia mentiría
   * por omisión —parecería que la confianza cambió sin motivo—, y con los identificadores
   * filtraría por la puerta de atrás justo lo que el alcance protege.
   */
  changesOutOfScope: number;
}

export class BrokenBeliefChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokenBeliefChainError';
  }
}

/**
 * Ordena las versiones de un asunto de la más antigua a la más reciente siguiendo la cadena.
 *
 * Detecta y rechaza las dos formas de cadena imposible:
 *
 * - **Bifurcación**: dos versiones que reemplazan a la misma. El esquema lo impide con un
 *   índice único sobre `supersedesInsightId`, pero una lectura no puede asumir que la
 *   restricción existe: si alguna vez se relajara, esta función lo convertiría en un error
 *   visible en lugar de en una historia silenciosamente incorrecta.
 * - **Ciclo**: A reemplaza a B y B reemplaza a A. Imposible por construcción —solo se
 *   supersede una versión anterior—, y aun así se comprueba: un ciclo colgaría el recorrido.
 */
export function orderBeliefChain(
  versions: BeliefVersionInput[],
): BeliefVersionInput[] {
  if (versions.length === 0) return [];

  const byId = new Map(versions.map((version) => [version.id, version]));
  const successorOf = new Map<string, BeliefVersionInput>();

  for (const version of versions) {
    const predecessorId = version.supersedesInsightId;
    if (predecessorId === null) continue;
    // Solo interesan las aristas internas al conjunto recibido: una cadena paginada puede
    // referirse a una versión que no vino en esta página.
    if (!byId.has(predecessorId)) continue;

    if (successorOf.has(predecessorId)) {
      throw new BrokenBeliefChainError(
        `La versión ${predecessorId} tiene más de una sucesora: la cadena está bifurcada`,
      );
    }
    successorOf.set(predecessorId, version);
  }

  // Raíces del conjunto: las que no son sucedidas por ninguna otra del propio conjunto.
  const superseded = new Set(successorOf.keys());
  const roots = versions.filter(
    (version) =>
      version.supersedesInsightId === null ||
      !byId.has(version.supersedesInsightId),
  );

  // Sin ninguna raíz pero con versiones, la cadena se muerde la cola. Se distingue de una
  // cadena incompleta porque el diagnóstico importa: son fallos de naturaleza distinta.
  if (roots.length === 0) {
    throw new BrokenBeliefChainError(
      'Ciclo detectado: ninguna versión encabeza la cadena de supersesión',
    );
  }

  const ordered: BeliefVersionInput[] = [];
  const visited = new Set<string>();

  for (const root of roots) {
    let current: BeliefVersionInput | undefined = root;
    while (current) {
      if (visited.has(current.id)) {
        throw new BrokenBeliefChainError(
          `Ciclo detectado en la cadena de supersesión en ${current.id}`,
        );
      }
      visited.add(current.id);
      ordered.push(current);
      current = successorOf.get(current.id);
    }
  }

  if (ordered.length !== versions.length) {
    throw new BrokenBeliefChainError(
      'La cadena de supersesión no cubre todas las versiones recibidas',
    );
  }
  // `superseded` solo se usa para razonar sobre raíces; se referencia para dejar explícito
  // que una versión sucedida jamás puede ser raíz.
  void superseded;

  return ordered;
}

/**
 * Atribuye el cambio entre dos versiones consecutivas.
 *
 * `visibleRefIds` es el conjunto de referencias que el lector puede ver, resuelto aguas
 * arriba contra su alcance de colección. Lo que quede fuera se cuenta, nunca se nombra.
 */
export function attributeTransition(params: {
  previous: BeliefVersionInput;
  next: BeliefVersionInput;
  /** `null` = sin acotar (alcance de organización completa). */
  visibleRefIds: Set<string> | null;
  /** refIds cuya fuente de conocimiento fue versionada desde la versión anterior. */
  supersededEvidenceRefIds?: Set<string>;
}): BeliefTransition {
  const { previous, next } = params;

  const previousRefs = new Map(
    previous.transitiveEvidenceClosure.map((ref) => [ref.refId, ref]),
  );
  const nextRefs = new Map(
    next.transitiveEvidenceClosure.map((ref) => [ref.refId, ref]),
  );
  const contradicting = new Set(next.contradictingRefIds);
  const supersededEvidence = params.supersededEvidenceRefIds ?? new Set();

  const all: EvidenceChange[] = [];

  for (const [refId, ref] of nextRefs) {
    if (!previousRefs.has(refId)) {
      all.push({ kind: 'ENTERED', ref });
      continue;
    }
    // Presente en ambas: solo es un cambio si contradice o si su fuente se versionó.
    if (contradicting.has(refId)) {
      all.push({ kind: 'CONTRADICTED', ref });
    } else if (supersededEvidence.has(refId)) {
      all.push({ kind: 'SUPERSEDED_EVIDENCE', ref });
    }
  }

  for (const [refId, ref] of previousRefs) {
    if (!nextRefs.has(refId)) all.push({ kind: 'LEFT', ref });
  }

  const visible =
    params.visibleRefIds === null
      ? all
      : all.filter((change) => params.visibleRefIds!.has(change.ref.refId));

  return {
    fromVersionId: previous.id,
    toVersionId: next.id,
    previousConfidence: previous.confidence,
    newConfidence: next.confidence,
    confidenceDelta: Number((next.confidence - previous.confidence).toFixed(4)),
    changes: visible,
    changesOutOfScope: all.length - visible.length,
  };
}

/**
 * Trayectoria completa: versiones en orden y transiciones entre ellas.
 *
 * Una cadena de una sola versión es una trayectoria válida —una creencia que nunca ha
 * cambiado— y no un caso degenerado: devuelve esa versión y ninguna transición.
 */
export function buildBeliefTrajectory(params: {
  versions: BeliefVersionInput[];
  visibleRefIds: Set<string> | null;
  supersededEvidenceRefIds?: Set<string>;
  /**
   * Versiones que el lector puede ver. `null` = todas.
   *
   * La cadena se ordena SIEMPRE completa antes de filtrar: ordenar sobre un subconjunto con
   * huecos daría una historia rota. Después se descartan las no visibles y se atribuyen las
   * transiciones entre las visibles CONSECUTIVAS, de modo que una versión oculta no parte la
   * historia en dos, solo desaparece de ella.
   */
  visibleVersionIds?: Set<string> | null;
}): {
  versions: BeliefVersionInput[];
  transitions: BeliefTransition[];
  hiddenVersionCount: number;
} {
  const ordered = orderBeliefChain(params.versions);

  const visibleVersions =
    params.visibleVersionIds == null
      ? ordered
      : ordered.filter((version) => params.visibleVersionIds!.has(version.id));

  const transitions: BeliefTransition[] = [];
  for (let index = 1; index < visibleVersions.length; index += 1) {
    transitions.push(
      attributeTransition({
        previous: visibleVersions[index - 1],
        next: visibleVersions[index],
        visibleRefIds: params.visibleRefIds,
        supersededEvidenceRefIds: params.supersededEvidenceRefIds,
      }),
    );
  }

  return {
    versions: visibleVersions,
    transitions,
    // Se informa cuántas quedaron fuera, nunca cuáles. Omitirlo en silencio presentaría una
    // historia incompleta como si fuera completa.
    hiddenVersionCount: ordered.length - visibleVersions.length,
  };
}
