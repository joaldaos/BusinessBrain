/**
 * Catálogo cerrado de acciones auditables — subfase 6.2.
 *
 * Las acciones son un catálogo tipado y no cadenas libres. Con cadenas libres, dos sitios
 * acaban escribiendo `agent.updated` y `agent.update` sin que nada falle, y el día que
 * alguien audita "todos los cambios de agentes" obtiene la mitad. Un registro de auditoría
 * cuyo vocabulario deriva no es un registro de auditoría: es ruido con marcas de tiempo.
 *
 * Convención `recurso.acción`, en pasado: describe un hecho consumado, no una intención.
 */

export const AUDIT_ACTIONS = {
  // ── Agentes: conceder capacidades y alcance de conocimiento ───────────────
  AGENT_CREATED: 'agent.created',
  AGENT_UPDATED: 'agent.updated',
  AGENT_DEACTIVATED: 'agent.deactivated',
  /** Denegación del gate de políticas. Ya existía desde 5.2; ahora pasa por el servicio. */
  AGENT_TOOL_DENIED: 'agent.tool.denied',

  // ── Automatizaciones: conceder ejecución DESATENDIDA ──────────────────────
  //
  // Crear una automatización no ejecuta nada por sí misma, pero concede que algo se ejecute
  // sin nadie delante y de forma repetida. Eso está al nivel de conceder capacidades a un
  // agente, no al de guardar una preferencia.
  AUTOMATION_CREATED: 'automation.created',
  AUTOMATION_UPDATED: 'automation.updated',
  AUTOMATION_DELETED: 'automation.deleted',
  /** Una ejecución desatendida terminó. Sin actor: no la provocó una persona. */
  AUTOMATION_RUN_FINISHED: 'automation.run.finished',

  // ── Integraciones externas ────────────────────────────────────────────────
  //
  // Conectar concede a BusinessBrain acceso de lectura al Drive de una empresa; desconectar
  // se lo retira y detiene lo que dependía de él. Ambas son cambios de permisos sobre un
  // sistema ajeno, y son justo lo que alguien querría poder reconstruir después.
  /**
   * Una sincronización comparó lo que hay en el origen con lo que tenemos.
   *
   * NUNCA elimina nada: marca lo ausente y desmarca lo que ha vuelto. La traza lo declara
   * explícitamente para que nadie tenga que deducirlo.
   */
  KNOWLEDGE_SOURCE_PRESENCE_RECONCILED: 'knowledge_source.presence_reconciled',

  INTEGRATION_CONNECTED: 'integration.connected',
  INTEGRATION_DISCONNECTED: 'integration.disconnected',

  // ── IA: elegir con qué proveedor —y con qué clave— piensa la empresa ──────
  /** Configurar la IA compromete gasto en la cuenta del cliente: queda traza. */
  /** El analisis PROPONE. No aprueba ni ejecuta: crea una propuesta pendiente de decision. */
  RECOMMENDATION_PROPOSED: 'recommendation.proposed',

  AI_CONFIGURED: 'ai.configured',
  AI_KEY_REMOVED: 'ai.key_removed',

  /** Crear una colección define una frontera de acceso: queda traza. */
  KNOWLEDGE_COLLECTION_CREATED: 'knowledge_collection.created',

  // ── Informes ──────────────────────────────────────────────────────────────
  //
  // El PDF no se almacena: se entrega y se descarta. La traza de generación es, por tanto,
  // el ÚNICO registro de qué contenía — por eso guarda el alcance con el que se leyó y la
  // evidencia exacta de cada sección, no solo que alguien lo pidió.
  REPORT_CREATED: 'report.created',
  REPORT_UPDATED: 'report.updated',
  REPORT_DELETED: 'report.deleted',
  REPORT_GENERATED: 'report.generated',

  // ── Plantillas: instalar concede capacidades ya configuradas ──────────────
  AGENT_TEMPLATE_CREATED: 'agent_template.created',
  AGENT_TEMPLATE_UPDATED: 'agent_template.updated',
  AGENT_TEMPLATE_REMOVED: 'agent_template.removed',
  AGENT_TEMPLATE_INSTALLED: 'agent_template.installed',

  // ── Acceso a conocimiento: es un cambio de PERMISOS ───────────────────────
  COLLECTION_ACCESS_GRANTED: 'collection_access.granted',
  COLLECTION_ACCESS_REVOKED: 'collection_access.revoked',

  // ── Objetivos de negocio: anclan todo juicio de valor (§8) ────────────────
  BUSINESS_OBJECTIVE_DECLARED: 'business_objective.declared',
  BUSINESS_OBJECTIVE_CONFIRMED: 'business_objective.confirmed',
  BUSINESS_OBJECTIVE_DISCARDED: 'business_objective.discarded',
  BUSINESS_OBJECTIVE_VERSIONED: 'business_objective.versioned',

  // ── Análisis: gasta dinero del cliente y lee toda la organización ─────────
  ANALYSIS_RUN_TRIGGERED: 'analysis_run.triggered',

  // ── Decisiones humanas sobre la comprensión ───────────────────────────────
  INSIGHT_CURATED: 'insight.curated',
  INSIGHT_CURATION_REVOKED: 'insight.curation_revoked',
  INSIGHT_ESCALATED: 'insight.escalated',
  /**
   * Una creencia cambió: nació una versión nueva y la anterior quedó superada (Fase 7).
   * Es un hecho del sistema, no de una persona: `actorId` queda nulo.
   */
  INSIGHT_VERSIONED: 'insight.versioned',

  // ── Decisiones humanas sobre las propuestas ───────────────────────────────
  RECOMMENDATION_ACCEPTED: 'recommendation.accepted',
  RECOMMENDATION_DISMISSED: 'recommendation.dismissed',

  // ── Plataforma (super admin) ──────────────────────────────────────────────
  USER_BANNED: 'user.banned',
  /** Desbanear NO es "banear con otro estado": es la acción contraria y se nombra aparte. */
  USER_UNBANNED: 'user.unbanned',
  ORGANIZATION_PLAN_CHANGED: 'organization.plan_changed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Tipos de entidad sobre los que se audita. También cerrado, y por el mismo motivo. */
export const AUDIT_TARGET_TYPES = {
  AGENT: 'Agent',
  AGENT_TEMPLATE: 'AgentTemplate',
  AUTOMATION: 'Automation',
  REPORT: 'Report',
  INTEGRATION: 'Integration',
  LLM_PROFILE: 'LlmProfile',
  KNOWLEDGE_SOURCE: 'KnowledgeSource',
  KNOWLEDGE_COLLECTION: 'KnowledgeCollection',
  BUSINESS_OBJECTIVE: 'BusinessObjective',
  ANALYSIS_RUN: 'AnalysisRun',
  INSIGHT: 'Insight',
  INSIGHT_FEEDBACK: 'InsightFeedback',
  RECOMMENDATION: 'Recommendation',
  USER: 'User',
  ORGANIZATION: 'Organization',
} as const;

export type AuditTargetType =
  (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];
