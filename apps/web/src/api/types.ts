/**
 * Formas que devuelve la API, tal como las emite el backend.
 *
 * Se declaran a mano en vez de generarse: son la superficie que esta interfaz consume de
 * verdad, no el esquema completo. Si el backend cambia un contrato, el error aparece aquí —
 * que es exactamente donde debe aparecer.
 */

export type MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/** Orden de privilegio. Se usa para no ofrecer acciones que el backend va a rechazar. */
const ROLE_RANK: Record<MembershipRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function hasRole(
  role: MembershipRole | undefined,
  minimum: MembershipRole,
): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  platformRole: string;
  memberships: { organizationId: string; role: MembershipRole }[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan?: string;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  /** `FILE_UPLOAD` recibe contenido; `WEBSITE` va a buscarlo y puede programarse. */
  type: string;
  connectorKey: string;
  status: string;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  status: string;
  /**
   * El documento ya no está en la fuente sincronizada que lo trajo.
   *
   * NO es una eliminación: el conocimiento sigue entero y consultable. Lo que ya no puede
   * hacerse es volver a comprobarlo contra su origen, y eso debe verse.
   */
  sourceMissingSince?: string | null;
  businessArea: string;
  confidenceScore: number;
  indexedAt: string | null;
  createdAt: string;
}

export type InsightFreshness = 'FRESH' | 'STALE' | 'UNRESOLVABLE';

/**
 * Curación humana vigente (§3.7, 7.1).
 *
 * `origin` distingue una decisión tomada sobre ESTA versión de una heredada de una anterior.
 * La interfaz nunca puede presentarlas igual: heredada significa que la persona validó una
 * afirmación distinta de la que se está mirando.
 */
export interface EffectiveCuration {
  type: string;
  comment: string | null;
  at: string;
  origin: 'OWN' | 'INHERITED';
  curatedVersionId: string;
  disputed: boolean;
}

export interface Insight {
  id: string;
  type: string;
  summary: string;
  status: string;
  confidence: number;
  freshness: InsightFreshness;
  freshnessRationale: string;
  strategyKey: string;
  evidence: { kind: string; role: string; refId: string | null }[];
  businessObjectives: { id: string; statement: string }[];
  curation: EffectiveCuration | null;
  createdAt: string;
}

export interface BeliefTransition {
  fromVersionId: string;
  toVersionId: string;
  previousConfidence: number;
  newConfidence: number;
  confidenceDelta: number;
  changes: {
    kind: 'ENTERED' | 'LEFT' | 'SUPERSEDED_EVIDENCE' | 'CONTRADICTED';
    ref: { kind: string; refId: string };
  }[];
  /** Cambios fuera del alcance del lector: recuento, jamás identificadores. */
  changesOutOfScope: number;
}

export interface BeliefHistory {
  subjectIdentity: string;
  versions: {
    id: string;
    confidence: number;
    status: string;
    createdAt: string;
    analysisRunId: string;
    summary: string;
    evidenceCount: number;
  }[];
  transitions: BeliefTransition[];
  hiddenVersionCount: number;
}

export interface BusinessObjective {
  id: string;
  statement: string;
  status: string;
  origin: string;
  createdAt: string;
}

export interface AnalysisRun {
  id?: string;
  analysisRunId?: string;
  status: string;
  candidatesGenerated?: number;
  insightsCreated?: number;
  insightsAlreadyKnown?: number;
  trigger?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
}

export interface Automation {
  id: string;
  name: string;
  triggerType: 'SCHEDULE' | 'EVENT' | 'MANUAL';
  triggerConfig: { cron?: string; timezone?: string };
  actions: { type: string; reportId?: string }[];
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  lastRunAt: string | null;
  nextRunAt: string | null;
  _count?: { runs: number };
}

export interface AutomationRun {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  logs: { at: string; action: string; outcome: string; detail: string }[];
  error: string | null;
}

export interface Report {
  id: string;
  name: string;
  format: string;
  template: { sections: ReportSection[] };
  createdAt: string;
  _count?: { runs: number };
}

export interface ReportSection {
  type: 'INSIGHTS' | 'KNOWLEDGE_SEARCH';
  title: string;
  query?: string;
  limit?: number;
  minimumConfidence?: number;
}

export interface ReportRun {
  id: string;
  status: string;
  generatedAt: string;
  /** Siempre nulo por decisión de producto: el fichero no se almacena. */
  fileUrl: string | null;
  error: string | null;
}

export interface Integration {
  id: string;
  provider: string;
  status: string;
  scope: string | null;
  expiresAt: string | null;
  createdAt: string;
  _count?: { knowledgeSources: number };
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface KnowledgeCollection {
  id: string;
  name: string;
}
