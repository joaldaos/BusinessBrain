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
  /**
   * Idioma en el que quiere que se le hable.
   *
   * Llega siempre resuelto: el backend cae al idioma por defecto si la persona no ha elegido
   * ninguno, así que aquí nunca hay que decidir qué hacer con un vacío.
   */
  locale: string;
  memberships: { organizationId: string; role: MembershipRole }[];
  /**
   * Si la cuenta tiene verificación en dos pasos activa.
   *
   * La interfaz lo usa para saber QUÉ pedir al confirmar la identidad —el código o la
   * contraseña— sin tener que provocar un error primero. Nunca para autorizar: quien decide es
   * `RecentAuthGuard`, igual que con los roles.
   */
  mfaEnabled: boolean;
  /** Hasta cuándo vale la última confirmación de identidad. Nulo si no hay ninguna. */
  reauthenticatedUntil: string | null;
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
  /** Nombre del campo tal como lo devuelve la API. */
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Frontera sincronizada en texto: la etiqueta, la carpeta o la dirección. */
  syncScope: string | null;
  /** Qué trajo la última ejecución. Sin esto, "sincronizado" no dice nada. */
  lastSync: {
    status: string;
    finishedAt: string | null;
    stats: {
      itemsFound?: number;
      itemsCreated?: number;
      itemsUpdated?: number;
      itemsSkippedDuplicate?: number;
      itemsFailed?: number;
      /** Entraron pero NO son preguntables: falta su representación vectorial. */
      itemsNotRetrievable?: number;
    } | null;
    error: string | null;
  } | null;
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
  /** Propuestas creadas en esta ejecución. Ninguna ejecuta nada: esperan decisión humana. */
  recommendationsProposed?: number;
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
  /** Cuenta externa conectada. Identidad de la conexión, nunca contenido indexado. */
  accountLabel: string | null;
  createdAt: string;
  _count?: { knowledgeSources: number };
}

export interface DriveFolder {
  id: string;
  name: string;
}

/** Etiqueta de Gmail. Actúa de FRONTERA: nada de fuera de ella entra en BusinessBrain. */
export interface GmailLabel {
  id: string;
  name: string;
}

export interface KnowledgeCollection {
  id: string;
  name: string;
}

/**
 * Una conversación con la empresa.
 *
 * `agentId` es opcional a propósito: sin agente, el turno se prepara con el alcance de la
 * PERSONA —las colecciones que tiene concedidas— y sin memoria ni herramientas. Es el camino
 * que usa la pantalla de preguntar, y el más estrecho de los dos.
 */
export interface Conversation {
  id: string;
  title: string | null;
  agentId: string | null;
  archivedAt: string | null;
  createdAt: string;
  messages?: ConversationMessage[];
}

export interface ConversationMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  /** De dónde salió la respuesta. Una respuesta sin citas no se sostiene en nada. */
  citations: MessageCitation[] | null;
  createdAt: string;
}

export interface MessageCitation {
  ordinal: number;
  knowledgeItemId: string;
  chunkId: string;
  label: string;
}

/** Lo que devuelve enviar un mensaje. Trae ya la respuesta, sus citas y qué comprensión usó. */
export interface SentMessage {
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  citations: MessageCitation[];
  insightsUsed: {
    id: string;
    summary: string;
    confidence: number;
    freshness: string;
  }[];
}

/** Invitación a la organización. El token es el enlace: no hay envío de correo todavía. */
export interface Invitation {
  id: string;
  email: string;
  role: MembershipRole;
  token: string;
  expiresAt: string;
}

/**
 * Estado de la IA de la organización.
 *
 * `origin` importa a una PYME más que "configurada": con `PROPIA` el consumo se factura en su
 * cuenta del proveedor; con `PLATAFORMA`, en la nuestra. La clave NUNCA viaja: lo único que se
 * sabe es si existe una propia.
 */
export interface AiConfiguration {
  origin: 'PROPIA' | 'PLATAFORMA' | 'SIN_CONFIGURAR';
  /** `true` cuando BusinessBrain puede leer documentos y responder preguntas. */
  ready: boolean;
  provider: string | null;
  modelName: string | null;
  hasOwnKey: boolean;
  /**
   * Qué situación es esta, sin depender de un idioma.
   *
   * La frase la escribe la interfaz, que es quien sabe en qué idioma se le habla a esta
   * persona. `explanation` sigue llegando en castellano para consumidores que no son la
   * interfaz, pero no es lo que se pinta.
   */
  explanationCode:
    | 'OWN_KEY'
    | 'OWN_PROFILE_PLATFORM_KEY'
    | 'PLATFORM'
    | 'NOT_CONFIGURED';
  explanation: string;
}

export interface AiProviderOption {
  provider: string;
  label: string;
  defaultModel: string;
  helpUrl: string;
  keyPrefixHint: string;
}

/**
 * Una propuesta de BusinessBrain.
 *
 * `createdById` nulo significa que la propuso el sistema a partir de una conclusión; con valor,
 * la redactó esa persona escalando manualmente. No son lo mismo a la hora de decidir, y la
 * pantalla las distingue.
 *
 * `status` NEW es "pendiente de tu decisión". Aceptar NO ejecuta nada: registra la decisión.
 */
export interface Recommendation {
  id: string;
  title: string;
  description: string;
  status: 'NEW' | 'ACCEPTED' | 'DISMISSED';
  priority: number;
  createdAt: string;
  createdById: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string; email: string } | null;
  /** Los ocho apartados del contrato. Nulos solo en propuestas antiguas. */
  detected: string | null;
  justification: string | null;
  estimatedImpact: string | null;
  advantages: string | null;
  drawbacks: string | null;
  affectedAreas: string | null;
  migrationPlan: string | null;
  /** De dónde sale: la conclusión que la originó. */
  sourceInsight: {
    id: string;
    summary: string;
    status: string;
    confidence: number;
  } | null;
}
