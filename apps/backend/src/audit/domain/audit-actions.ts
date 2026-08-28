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

  // ── Datos de la empresa: llevárselos y borrarlos ──────────────────────────
  //
  // Las dos son irreversibles a su manera: una saca una copia completa fuera del sistema, la
  // otra no deja nada. Quien responde por la empresa tiene que poder demostrar después quién
  // las hizo y cuándo.
  ORGANIZATION_DATA_EXPORTED: 'organization.data_exported',
  /**
   * Se escribe SIN `organizationId`, y tiene que ser así: `AuditLog` cuelga de la organización
   * en cascada, así que una entrada con su identificador se habría borrado con ella.
   */
  ORGANIZATION_DATA_ERASED: 'organization.data_erased',

  // ── Seguridad de la cuenta: la verificación en dos pasos y la contraseña ──
  //
  // ## Por qué se auditan también los INTENTOS
  //
  // El resto del catálogo registra hechos consumados. Aquí hay dos excepciones deliberadas
  // —`mfa.code_failed` y `sensitive_action.denied`— porque en seguridad el patrón de lo que
  // NO salió es la señal: cuarenta códigos fallidos seguidos es una información que no existe
  // en ninguna parte si solo se registran los aciertos.
  //
  // Ninguna de estas entradas lleva jamás el secreto, el código ni la contraseña. Lo que se
  // registra es que ocurrió, cuándo y desde qué sesión — nunca con qué.
  MFA_ENABLED: 'mfa.enabled',
  MFA_DISABLED: 'mfa.disabled',
  /** Un código correcto: al entrar o al reautenticarse. */
  MFA_CODE_VERIFIED: 'mfa.code_verified',
  /** Un código rechazado. Ver arriba por qué se registra un intento fallido. */
  MFA_CODE_FAILED: 'mfa.code_failed',
  /** Se gastó un código de papel. Nunca CUÁL: solo que quedan n-1. */
  MFA_RECOVERY_CODE_USED: 'mfa.recovery_code_used',
  MFA_RECOVERY_CODES_REGENERATED: 'mfa.recovery_codes_regenerated',
  /**
   * El propietario le retiró el segundo factor a un administrador de SU empresa.
   *
   * Es una acción de TENANT —lleva `organizationId`— porque la decide quien responde por esa
   * empresa sobre alguien de esa empresa. La de plataforma es otra, y vive abajo.
   */
  MFA_REMOVED_BY_OWNER: 'mfa.removed_by_owner',

  PASSWORD_CHANGED: 'password.changed',
  /** Alguien demostró su identidad para poder hacer algo sensible. */
  REAUTHENTICATED: 'auth.reauthenticated',
  /** Se intentó algo sensible sin poder demostrar la identidad. */
  SENSITIVE_ACTION_DENIED: 'auth.sensitive_action_denied',

  // ── Plataforma: quien OPERA BusinessBrain, no quien lo usa ────────────────
  //
  // ## Por qué llevan su propio espacio de nombres
  //
  // Una acción de plataforma y una de cliente no se leen igual ni las mira la misma persona.
  // El prefijo `platform.` permite consultar "qué ha hecho la administración" sin arrastrar la
  // actividad de los clientes, que es justo lo que hay que poder auditar aparte.
  //
  // ## Y por qué TODAS se escriben con `organizationId: null`
  //
  // `AuditLog` cuelga de la organización en cascada. Una acción administrativa registrada con
  // el identificador de la empresa afectada **desaparecería al borrar esa empresa** — y lo que
  // hizo la plataforma sobre un cliente es precisamente lo que hay que conservar después de
  // que el cliente se vaya. La organización afectada viaja en `metadata`.
  //
  // Ya se aprendió una vez: el borrado de datos de una organización se registra así desde que
  // se construyó, por este mismo motivo.
  USER_BANNED: 'platform.user.banned',
  /** Desbanear NO es "banear con otro estado": es la acción contraria y se nombra aparte. */
  USER_UNBANNED: 'platform.user.unbanned',
  ORGANIZATION_PLAN_CHANGED: 'platform.organization.plan_changed',

  /**
   * Alguien de la plataforma ha leído la lista de personas de los clientes.
   *
   * Es una LECTURA y aun así se audita, a diferencia del resto de listados: son nombres y
   * correos de empleados de empresas clientes, es decir, datos personales de terceros. Que
   * mirarlos no cambie nada no significa que no haya que poder responder quién los miró.
   */
  PLATFORM_USERS_LISTED: 'platform.users.listed',
  // ── Acceso administrativo a los datos de UN cliente ───────────────────────
  //
  // Las cuatro etapas del ciclo, y las cuatro se registran: pedirlo, que el propietario lo
  // apruebe, usarlo y retirarlo. Sin la de USO, la traza diria que hubo permiso y no cuantas
  // veces se ejercio — que es justo lo que hay que poder responderle a un cliente.
  //
  // La aprobacion la hace el PROPIETARIO de la empresa y aun asi vive en el espacio de
  // plataforma: lo que se registra no es actividad de su negocio, es una decision sobre el
  // acceso de la plataforma a sus datos.
  PLATFORM_ACCESS_REQUESTED: 'platform.access.requested',
  PLATFORM_ACCESS_APPROVED: 'platform.access.approved',
  PLATFORM_ACCESS_USED: 'platform.access.used',
  PLATFORM_ACCESS_REVOKED: 'platform.access.revoked',

  /**
   * La administración retiró el segundo factor de una cuenta de cliente. Último recurso.
   *
   * Es lo más cerca que la plataforma llega de la cuenta de una persona, y por eso lleva
   * motivo obligatorio y avisa por correo al afectado y al propietario de su empresa. Lo que
   * NO hace —y no puede hacer— es dar acceso: después sigue haciendo falta la contraseña de
   * esa persona. Retirar el segundo factor es degradar una cuenta de dos pruebas a una, no
   * entrar en ella.
   */
  PLATFORM_MFA_REMOVED: 'platform.user.mfa_removed',
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
  PLATFORM_ACCESS_GRANT: 'PlatformAccessGrant',
} as const;

export type AuditTargetType =
  (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];
