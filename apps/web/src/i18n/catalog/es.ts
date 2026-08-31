/**
 * El catálogo en castellano: la fuente de todo lo que se lee en pantalla.
 *
 * ## Por qué este catálogo es el que manda
 *
 * El producto está escrito en castellano y sus primeros clientes son PYMEs españolas. Cuando
 * falta una traducción en otro idioma se cae aquí, así que este es el único que tiene que
 * estar completo — y por eso las claves se derivan de él: si una pantalla pide una clave que
 * no existe aquí, no compila.
 *
 * ## Cómo se nombran las claves
 *
 * `pantalla.sección.cosa`. No por el texto ("guardar" vale para diez botones distintos) sino
 * por dónde vive, porque cuando alguien traduzca al francés necesitará saber en qué contexto
 * aparece cada frase: "Guardar" en una configuración y "Guardar" en un formulario de alta
 * pueden ser palabras distintas en otro idioma.
 *
 * ## Lo que NUNCA se pone aquí
 *
 * Contenido de la empresa. Los títulos de sus documentos, sus conclusiones y sus
 * recomendaciones se muestran tal cual: son suyos, están en el idioma en el que los escribió y
 * traducirlos sería alterarlos.
 */
export const es = {
  // ── Común ────────────────────────────────────────────────────────────────
  'common.loading': 'Cargando…',
  'common.save': 'Guardar',
  'common.saving': 'Guardando…',
  'common.cancel': 'Cancelar',
  'common.create': 'Crear',
  'common.delete': 'Eliminar',
  'common.close': 'Cerrar',
  'common.back': 'Volver',
  'common.none': '—',
  'common.moment': 'Un momento…',
  'common.retry': 'Reintentar',
  'common.yes': 'Sí',
  'common.no': 'No',
  'common.of': 'de',
  'common.sessionLoading': 'Cargando tu sesión…',


  // ── Estados de cualquier pantalla ─────────────────────────────────────────
  'state.retry': 'Reintentar',
  'state.empty': 'Todavía no hay nada aquí.',
  'state.error.unknown': 'No hemos podido cargar esto.',
  'state.error.unknownHint': 'Puede ser algo momentáneo. Vuelve a intentarlo; si sigue igual, avísanos.',
  'state.error.forbidden': 'No tienes permiso para ver esto.',
  'state.error.missing': 'Esto ya no existe.',

  'page.insights.subtitle': 'Lo que BusinessBrain ha entendido de tus documentos. Cada conclusión dice de dónde sale y si sigue vigente.',
  'page.objectives.subtitle': 'Lo que tu empresa quiere conseguir. Sin objetivos, el sistema describe lo que pasa pero no puede decirte si importa.',
  'page.analysis.subtitle':
    'Pídele a BusinessBrain que repase todo lo que ha leído y te diga qué ha encontrado.',
  'page.recommendations.subtitle': 'Qué te conviene hacer, con el porqué delante. Tú decides: aceptar, descartar o dejarlo para más adelante.',
  'page.automations.subtitle': 'Tareas que se ejecutan solas cuando toca. Cada una deja registro de qué hizo y cuándo.',
  'page.reports.subtitle': 'Lo entendido, reunido en un documento que puedes enviar o guardar.',
  'nav.account': 'Mi cuenta',
  'shell.menu': 'Menú',
  'dashboard.subtitle': 'Lo que BusinessBrain sabe de tu empresa y qué conviene hacer ahora.',
  'dashboard.steps.subtitle': 'Cinco pasos para que BusinessBrain empiece a entender tu empresa.',
  'dashboard.attention.subtitle': 'Conclusiones que han dejado de encajar con lo que sabe el sistema.',
  'dashboard.latest.subtitle': 'Lo que ha deducido por su cuenta a partir de tus documentos.',
  'dashboard.latest.seeAll': 'Ver todas',
  'dashboard.latest.emptyTitle': 'Aquí aparecerá lo que BusinessBrain descubra.',
  'dashboard.latest.emptyBody': 'Cuando tenga documentos y lances un análisis, buscará por su cuenta riesgos, desviaciones y oportunidades, y te dirá de qué documento ha sacado cada una.',
  'dashboard.metric.documentsEmpty': 'Lo que suba tu empresa',
  'dashboard.metric.conclusionsEmpty': 'Lo que deduzca el análisis',
  'dashboard.metric.automationsEmpty': 'Análisis e informes solos',
  'dashboard.metric.reportsEmpty': 'Informes con citas',
  'platform.mfaGate.title': 'Activa la verificación en dos pasos',
  'platform.mfaGate.subtitle': 'Es obligatoria para administrar BusinessBrain. Hasta que la tengas, el resto del panel está cerrado.',
  'platform.mfaGate.why': 'Tu cuenta puede pedir acceso a los datos de cualquier empresa cliente. Si alguien consiguiera tu contraseña, no sería el problema de una empresa: sería el de todas. Por eso aquí el segundo factor no es opcional.',
  'platform.mfaGate.step1': 'Abre tu aplicación de autenticación en el móvil, o instala una si no tienes.',
  'platform.mfaGate.step2': 'Escanea el código que te enseñaremos y escribe los seis dígitos.',
  'platform.mfaGate.step3': 'Guarda los códigos de repuesto en un sitio seguro: son tu salida si pierdes el móvil.',
  'platform.mfaGate.action': 'Activarla ahora',
  'platform.mfaGate.footnote': 'Tarda menos de un minuto y solo hay que hacerlo una vez.',

  'account.title': 'Mi cuenta',
  'account.subtitle': 'Lo que es tuyo y viaja contigo aunque cambies de empresa.',
  'account.who': 'Quién eres',
  'account.whoHint': 'Así te identifica BusinessBrain y así te ven tus compañeros.',
  'settings.title': 'Configuración de la empresa',
  'settings.subtitle': 'Lo que pertenece a tu empresa y afecta a todo el equipo.',
  'settings.section.ai': 'Inteligencia artificial',
  'settings.section.privacy': 'Privacidad y datos',
  'settings.section.company': 'Empresa',
  'settings.section.team': 'Equipo y accesos',

  // ── Navegación ───────────────────────────────────────────────────────────
  'nav.group.understand': 'Entender',
  'nav.group.decide': 'Decidir',
  'nav.group.execute': 'Ejecutar',
  'nav.group.account': 'Tu cuenta',
  'nav.dashboard': 'Panel',
  'nav.ask': 'Preguntar',
  'nav.knowledge': 'Conocimiento',
  'nav.insights': 'Comprensión',
  'nav.objectives': 'Objetivos',
  'nav.analysis': 'Análisis',
  'nav.recommendations': 'Recomendaciones',
  'nav.automations': 'Automatizaciones',
  'nav.reports': 'Informes',
  'nav.settings': 'Configuración',

  // ── Marco ────────────────────────────────────────────────────────────────
  'shell.activeOrganization': 'Organización activa',
  'shell.logout': 'Salir',

  // ── Vocabulario del sistema, dicho en castellano ─────────────────────────
  //
  // El backend habla con constantes cerradas porque eso es lo correcto para un modelo de
  // datos. Pintarlas tal cual pone en la pantalla de una panadería palabras que no significan
  // nada. Aquí se traducen; en ningún otro sitio.
  'status.knowledgeItem.PENDING': 'esperando turno',
  'status.knowledgeItem.PROCESSING': 'leyéndolo',
  'status.knowledgeItem.INDEXED': 'listo para consultar',
  'status.knowledgeItem.FAILED': 'no se ha podido leer',
  'status.knowledgeItem.SUPERSEDED': 'versión anterior',
  'status.knowledgeItem.DELETED': 'eliminado',

  'status.insightType.PATTERN': 'patrón',
  'status.insightType.ANOMALY': 'desviación',
  'status.insightType.RISK': 'riesgo',
  'status.insightType.OPPORTUNITY': 'oportunidad',

  'status.evidenceKind.KNOWLEDGE_ITEM': 'un documento tuyo',
  'status.evidenceKind.KNOWLEDGE_CHUNK': 'un pasaje de un documento',
  'status.evidenceKind.CANONICAL_ENTITY': 'un hecho recogido en varios documentos',
  'status.evidenceRole.BASELINE': 'lo sostiene',
  'status.evidenceRole.DEVIATION': 'es lo que se ha desviado',
  'status.evidenceRole.CONTRADICTION': 'lo contradice',
  'insight.evidence.none':
    'No queda nada dentro de tu alcance que sostenga esta conclusión.',

  'status.freshness.FRESH': 'al día',
  'status.freshness.STALE': 'lo que la sostenía ha cambiado',
  'status.freshness.UNRESOLVABLE': 'ya no se puede comprobar',

  'status.run.PENDING': 'en cola',
  'status.run.RUNNING': 'en curso',
  'status.run.SUCCESS': 'correcto',
  'status.run.FAILED': 'con errores',
  'status.run.PARTIAL': 'parcial',
  'status.run.CANCELLED': 'cancelado',

  'status.connection.PENDING': 'sin leer todavía',
  'status.connection.CONNECTED': 'conectada',
  'status.connection.SYNCING': 'leyendo',
  'status.connection.ERROR': 'con problemas',
  'status.connection.DISABLED': 'desconectada',

  'status.role.OWNER': 'propietario',
  'status.role.ADMIN': 'administrador',
  'status.role.MEMBER': 'miembro',
  'status.role.VIEWER': 'solo lectura',

  'status.automation.ACTIVE': 'activa',
  'status.automation.PAUSED': 'pausada',
  'status.automation.ERROR': 'con problemas',

  'status.insight.CANDIDATE': 'candidata',
  'status.insight.ACTIVE': 'activa',
  'status.insight.SUPERSEDED': 'sustituida',
  'status.insight.DISCARDED': 'descartada',
  'status.insight.EXPIRED': 'caducada',

  'status.recommendation.NEW': 'pendiente',
  'status.recommendation.ACCEPTED': 'aceptada',
  'status.recommendation.DISMISSED': 'descartada',

  // ── Entrar y crear cuenta ────────────────────────────────────────────────
  'login.tagline': 'La capa de inteligencia de tu empresa.',
  'login.invited':
    'Te han invitado a una empresa en BusinessBrain. Entra o crea tu cuenta con el correo al que te invitaron y quedarás dentro.',
  'login.name': 'Nombre',
  'login.email': 'Correo',
  'login.password': 'Contraseña',
  'login.signIn': 'Entrar',
  'login.createAccount': 'Crear cuenta',
  'login.toRegister': '¿No tienes cuenta? Crear una',
  'login.toLogin': 'Ya tengo cuenta',
  'login.forgot': '¿Has olvidado tu contraseña?',
  'login.invitationFailed':
    'Has entrado, pero la invitación no se pudo aceptar: {reason}',

  // ── Recuperar la contraseña ──────────────────────────────────────────────
  'recovery.title': '¿Has olvidado tu contraseña?',
  'recovery.explain': 'Escribe tu correo y te mandamos un enlace para elegir una nueva.',
  'recovery.submit': 'Enviarme el enlace',
  'recovery.sending': 'Enviando…',
  'recovery.backToLogin': 'Volver a la entrada',
  'recovery.sentTitle': 'Mira tu correo.',
  'recovery.sentBody':
    'Si hay una cuenta con esa dirección, acabas de recibir un enlace para elegir una contraseña nueva. Caduca en una hora.',
  'recovery.sentHint':
    '¿No te ha llegado? Comprueba la carpeta de correo no deseado, o revisa si la dirección era otra.',
  'recovery.incompleteTitle': 'Este enlace está incompleto.',
  'recovery.incompleteBody': 'Copia el enlace entero desde el correo, o pide uno nuevo.',
  'recovery.askNew': 'Pedir un enlace nuevo',
  'recovery.doneTitle': 'Ya tienes contraseña nueva.',
  'recovery.doneBody':
    'Por seguridad hemos cerrado las sesiones que estuvieran abiertas en otros dispositivos.',
  'recovery.chooseTitle': 'Elige tu contraseña nueva',
  'recovery.passwordHint': 'Al menos 8 caracteres.',
  'recovery.repeat': 'Repítela',
  'recovery.mismatch': 'Las dos contraseñas no son iguales.',
  'recovery.submitNew': 'Guardar y entrar',

  // ── Crear la empresa ─────────────────────────────────────────────────────
  'onboarding.title': 'Bienvenido a BusinessBrain',
  'onboarding.intro':
    'Lo primero es dar de alta tu empresa. Todo lo que BusinessBrain aprenda —documentos, correo, conclusiones— vivirá dentro de ella y no se mezclará nunca con la de nadie más.',
  'onboarding.introNamed':
    '{name}, lo primero es dar de alta tu empresa. Todo lo que BusinessBrain aprenda —documentos, correo, conclusiones— vivirá dentro de ella y no se mezclará nunca con la de nadie más.',
  'onboarding.companyName': 'Nombre de tu empresa',
  'onboarding.companyHint': 'Podrás cambiarlo después en Configuración.',
  'onboarding.companyPlaceholder': 'Panadería Ruiz S.L.',
  'onboarding.creating': 'Creando…',
  'onboarding.create': 'Crear mi empresa',
  'onboarding.alreadyInside':
    'Si alguien de tu empresa ya usa BusinessBrain, pídele que te invite en vez de crear una segunda: así compartiréis el mismo conocimiento.',

  // ── Idioma ───────────────────────────────────────────────────────────────
  'settings.language': 'Idioma',
  'settings.languageHint':
    'Cambia la interfaz y el idioma en el que te responde BusinessBrain. No traduce tus documentos: siguen como los subiste.',

  // ── Panel ────────────────────────────────────────────────────────────────
  'dashboard.metric.documents': 'Documentos',
  'dashboard.metric.conclusions': 'Conclusiones',
  'dashboard.metric.automations': 'Automatizaciones',
  'dashboard.metric.reports': 'Informes',
  'dashboard.todo.title': 'Lo que espera por ti',
  'dashboard.todo.recommendations': 'Recomendaciones esperando tu decisión',
  'dashboard.todo.recommendationsWhy':
    'BusinessBrain las ha propuesto a partir de tus documentos. Ninguna se ejecuta sola.',
  'dashboard.todo.disputed': 'Conclusiones que alguien ha puesto en duda',
  'dashboard.todo.stale': 'Conclusiones cuyo documento ha cambiado',
  'dashboard.todo.see': 'Revisar',
  'dashboard.calm.title': 'No hay nada esperando por ti',
  'dashboard.calm.body':
    'BusinessBrain sigue vigilando tus documentos. Si algo cambia o encuentra algo que no encaja, aparecerá aquí.',
  'dashboard.state.title': 'Lo que sabe de tu empresa',
  'dashboard.state.documents': 'documentos leídos',
  'dashboard.state.conclusions': 'conclusiones',
  'dashboard.state.lastAnalysis': 'Último análisis el {date}',
  'dashboard.state.neverAnalysed': 'Todavía no has lanzado ningún análisis.',
  'dashboard.state.ask': 'Preguntar',
  'dashboard.state.analyse': 'Analizar ahora',
  'dashboard.attention.title': 'Requiere tu atención',
  'dashboard.attention.disputedWhy':
    'Alguien validó una versión anterior y la evidencia nueva la contradice.',
  'dashboard.latest.title': 'Lo último que hemos comprendido',
  'dashboard.latest.empty':
    'Todavía no hay conclusiones. Sube conocimiento y lanza un análisis.',
  'dashboard.steps.title': 'Primeros pasos',
  'dashboard.steps.progress': '{done} de {total} completados.',
  'dashboard.steps.ai.action': 'Configura la inteligencia artificial',
  'dashboard.steps.ai.why':
    'Sin ella BusinessBrain no puede leer tus documentos ni responder preguntas.',
  'dashboard.steps.source.action': 'Conecta una fuente',
  'dashboard.steps.source.why':
    'Sube documentos, una página web, tu Google Drive o una etiqueta de Gmail.',
  'dashboard.steps.sync.action': 'Sube tu primer documento',
  'dashboard.steps.sync.why':
    'Hasta que no entre nada, BusinessBrain no sabe nada de tu empresa.',
  'dashboard.steps.ask.action': 'Hazle una pregunta',
  'dashboard.steps.ask.why':
    'Responderá con lo que sabe y te dirá de qué documentos lo ha sacado.',
  'dashboard.steps.analysis.action': 'Lanza un análisis',
  'dashboard.steps.analysis.why':
    'Busca por su cuenta riesgos, anomalías y oportunidades en lo que ya sabe.',

  // ── Comprensión ──────────────────────────────────────────────────────────
  'common.confidence.low': 'baja',
  'common.confidence.medium': 'media',
  'common.confidence.high': 'alta',
  'insights.title': 'Conclusiones ({count})',
  'insights.empty':
    'No hay conclusiones dentro de tu alcance. Puede que no haya análisis todavía, o que no tengas acceso a las colecciones que las sostienen.',
  'insight.badge.freshEvidence': 'al día',
  'insight.badge.evidenceChanged': 'lo que la sostenía ha cambiado',
  'insight.badge.evidenceUnresolvable': 'ya no se puede comprobar',
  'insight.badge.disputed': 'lo decidido ya no encaja',
  'insight.badge.inherited': 'decidido sobre una versión anterior',
  'insight.badge.curated': 'revisado por una persona',

  // ── Análisis ─────────────────────────────────────────────────────────────
  'analysis.found.title': 'Qué ha descubierto',
  'analysis.found.none':
    'Este análisis no ha encontrado nada nuevo. Es normal si desde el anterior no ha entrado conocimiento nuevo.',
  'analysis.found.seeAll': 'Ver toda la comprensión',
  'analysis.proposed.title': 'Y qué te propone',
  'analysis.proposed.seeAll': 'Ver las recomendaciones',
  'analysis.last.title': 'Último análisis',
  'analysis.last.created': 'conclusiones nuevas',
  'analysis.last.updated': 'conclusiones actualizadas',
  'analysis.last.proposals': 'recomendaciones para revisar',
  'analysis.last.when': 'Analizado el {date}',
  'analysis.last.running': 'Analizando ahora mismo…',
  'analysis.last.failed': 'El último análisis no llegó a terminar.',
  'analysis.last.nothingNew':
    'No ha encontrado nada nuevo. Es normal si desde el último análisis no ha entrado conocimiento nuevo.',
  'analysis.needs.title': 'Qué necesita para poder analizar',
  'analysis.needs.knowledge': 'Documentos de tu empresa',
  'analysis.needs.knowledgeWhy':
    'Es sobre lo que razona. Sin nada leído, no hay nada que analizar.',
  'analysis.needs.objectives': 'Al menos un objetivo',
  'analysis.needs.objectivesWhy':
    'Sin objetivos puede describir lo que pasa, pero no decirte si es un riesgo o una oportunidad.',
  'analysis.needs.go': 'Ir a Conocimiento',
  'analysis.needs.goObjectives': 'Ir a Objetivos',
  'analysis.empty.title': 'BusinessBrain todavía no ha analizado tu empresa',
  'analysis.empty.body':
    'Recorre por su cuenta todo lo que ha leído y busca riesgos, desviaciones y oportunidades. De ahí salen las conclusiones y las recomendaciones.',
  'analysis.history.title': 'Análisis anteriores',
  'analysis.history.summary': '{created} nuevas · {updated} actualizadas',
  'analysis.needsAdmin.title': 'Solo un administrador puede lanzar un análisis',
  'analysis.needsAdmin.body':
    'Un análisis lee todo el conocimiento de la empresa y consume la clave de inteligencia artificial que ella paga. Pídeselo a quien administre BusinessBrain en tu empresa; la comprensión que produzca sí la verás tú.',
  'analysis.run.button': 'Analizar ahora',
  'analysis.run.busy': 'Analizando…',
  'analysis.runs.title': 'Ejecuciones',
  'analysis.runs.column.status': 'Estado',
  'analysis.runs.column.origin': 'Origen',
  'analysis.runs.column.started': 'Inicio',
  'analysis.runs.column.finished': 'Fin',
  'analysis.trigger.automatic': 'automático',
  'analysis.trigger.manual': 'manual',

  // ── Objetivos ────────────────────────────────────────────────────────────
  'objectives.pending.title': 'Esperando tu confirmación',
  'objectives.pending.why':
    'BusinessBrain cree haber deducido esto de tus documentos. Hasta que lo confirmes no lo usa para decidir qué es importante.',
  'objectives.active.title': 'Objetivos en marcha',
  'objectives.active.why':
    'Con estos objetivos, BusinessBrain puede decirte si lo que encuentra es un riesgo o una oportunidad, y no solo describirlo.',
  'objectives.new.open': 'Crear objetivo',
  'objectives.new.cancel': 'Cancelar',
  'objectives.declaredBy': 'Lo dijo una persona',
  'objectives.deducedBy': 'Lo dedujo BusinessBrain',
  'objectives.since': 'desde el {date}',
  'objectives.created': 'Objetivo creado. Ya cuenta para el próximo análisis.',
  'objectives.confirmed': 'Confirmado. BusinessBrain ya lo tiene en cuenta.',
  'objectives.discarded': 'Descartado. Deja de contar para los análisis.',
  'objectives.empty.title': 'Todavía no le has dicho a BusinessBrain qué quieres conseguir',
  'objectives.empty.body':
    'Es una frase corta con lo que quieres lograr: mantener el margen, reducir las devoluciones, cobrar antes.',
  'objectives.empty.example': 'Por ejemplo: «El margen comercial no debe bajar del 30 %».',
  'objectives.declare.title': 'Declarar un objetivo',
  'objectives.declare.why':
    'Sin un objetivo confirmado, el sistema puede decirte qué está pasando, pero no si eso es un riesgo o una oportunidad para tu empresa.',
  'objectives.field': 'Objetivo',
  'objectives.placeholder': 'El margen comercial no debe bajar del 30 %.',
  'objectives.declare': 'Declarar',
  'objectives.title': 'Objetivos ({count})',
  'objectives.status.confirmed': 'confirmado',
  'objectives.status.inferred': 'propuesto por el sistema',
  'objectives.origin.person': 'una persona',
  'objectives.origin.inferred': 'inferido',
  'objectives.confirm': 'Confirmar',
  'objectives.discard': 'Descartar',

  // ── Preguntar ────────────────────────────────────────────────────────────
  'ask.subtitle': 'Escribe lo que quieras saber. Responde con lo que hay en los documentos de tu empresa, y te enseña de dónde lo ha sacado.',
  'ask.tryThis': 'Prueba a preguntar',
  'ask.emptyList': 'Aún no has preguntado nada.',
  'ask.thinkingHint': 'Leyendo tus documentos y comprobando de dónde sale cada dato.',
  'ask.you': 'Tú',
  'ask.brain': 'BusinessBrain',
  'ask.list.title': 'Tus preguntas',
  'ask.new': 'Nueva pregunta',
  'ask.untitled': 'Sin título',
  'ask.title': 'Pregúntale a tu empresa',
  'ask.intro': 'Pregunta con tus palabras. Responderá con lo que sabe de tu empresa.',
  'ask.example1': '¿Qué acordamos con nuestro principal proveedor?',
  'ask.example2': '¿Cuál es nuestra política de descuentos?',
  'ask.example3': '¿Qué hemos decidido sobre las devoluciones?',
  'ask.noInvent': 'Si no tiene información suficiente, lo dirá en lugar de inventarla.',
  'ask.thinking': 'Buscando en tu conocimiento…',
  'ask.input.label': 'Tu pregunta',
  'ask.input.placeholder': '¿Qué quieres saber de tu empresa?',
  'ask.send': 'Preguntar',
  'ask.sending': 'Preguntando…',
  'ask.noSources': 'Sin fuentes: esta respuesta no se apoya en ningún documento tuyo.',
  'ask.sources': 'Fuentes',
  'ask.sourceMissing': 'ya no está en su origen',
  'ask.indexedAt': 'añadido el {date}',

  // ── Recomendaciones ──────────────────────────────────────────────────────
  'recs.pending.title': 'Pendientes de tu decisión ({count})',
  'recs.pending.governance':
    'BusinessBrain te propone; decides tú. Aceptar deja constancia de la decisión — no ejecuta ninguna acción ni cambia nada fuera de aquí.',
  'recs.pending.empty':
    'No hay nada pendiente. Cuando un análisis encuentre algo que merezca una acción, aparecerá aquí.',
  'recs.history.title': 'Decisiones anteriores',
  'recs.history.show': 'Ver decisiones anteriores',
  'recs.history.hide': 'Ocultar',
  'recs.history.empty': 'Todavía no has aceptado ni descartado ninguna.',
  'recs.someone': 'alguien',
  'recs.author.person': 'propuesta por una persona',
  'recs.author.system': 'propuesta por BusinessBrain',
  'recs.field.detected': 'Qué hemos detectado',
  'recs.field.justification': 'Por qué importa',
  'recs.field.impact': 'Impacto esperado',
  'recs.field.areas': 'Áreas afectadas',
  'recs.field.advantages': 'A favor',
  'recs.field.drawbacks': 'En contra',
  'recs.field.plan': 'Por dónde empezar',
  'recs.evidence.show': 'Ver en qué se basa',
  'recs.evidence.hide': 'Ocultar',
  'recs.evidence.why': '¿Por qué me propones esto?',
  'recs.evidence.from': 'Sale de esta conclusión:',
  'recs.evidence.openIt':
    '(confianza {confidence}) — ábrela para ver los documentos en los que se apoya.',
  'recs.evidence.gone': 'La conclusión que la originó ya no está disponible.',
  'recs.accept': 'Aceptar',
  'recs.dismiss': 'Descartar',
  'recs.readOnly': 'Solo lectura: pide a un compañero con permisos que decida.',

  // ── Detalle de una conclusión ────────────────────────────────────────────
  'insight.finding.CONFIDENCE_DECAYED.title':
    '«{document}» ya no ofrece la seguridad que pide tu empresa',
  'insight.finding.CONFIDENCE_DECAYED.detected':
    'Ha dejado de alcanzar el nivel de fiabilidad que tu empresa exige para usar un documento como referencia.',
  'insight.finding.CONFIDENCE_DECAYED.matters':
    'Mientras siga así, BusinessBrain no lo usará para responder preguntas. Conviene revisarlo o volver a subirlo actualizado.',
  'insight.finding.SOURCE_DISCONNECTED.title':
    'La fuente «{source}» ha dejado de traer información',
  'insight.finding.SOURCE_DISCONNECTED.detected':
    'Está desconectada o está dando error, así que lo que llegaba por ella ya no se actualiza.',
  'insight.finding.SOURCE_DISCONNECTED.matters':
    'Hay {count} documentos que dependen de ella y se están quedando desfasados.',
  'insight.finding.CANONICALIZATION_UNRESOLVED.title':
    '{count} documentos dicen cosas distintas sobre lo mismo',
  'insight.finding.CANONICALIZATION_UNRESOLVED.detected':
    'BusinessBrain no puede determinar por su cuenta cuál de ellos prevalece.',
  'insight.finding.CANONICALIZATION_UNRESOLVED.matters':
    'Hasta que alguien lo decida, las respuestas sobre este punto pueden quedarse incompletas.',
  'insight.finding.goKnowledge': 'Ir a Conocimiento',
  'insight.finding.detected': 'Qué hemos detectado',
  'insight.finding.matters': 'Por qué importa',
  'insight.finding.source': 'De dónde sale',
  'insight.finding.detail': 'Ver el detalle técnico',
  'insight.finding.detailHide': 'Ocultar el detalle',
  'insight.finding.detailWhy':
    'Lo que registró el sistema al detectarlo, tal cual. Sirve para comprobarlo o para contárselo a quien lleve vuestros sistemas.',
  'insight.certainty.inline': 'seguridad {level}',
  'insight.certainty.label': 'Seguridad de esta conclusión',
  'insight.certainty.explain':
    'Cuánta seguridad tiene BusinessBrain en lo que afirma aquí. No es la fiabilidad de los documentos: esa se ve en Conocimiento, documento a documento.',
  'insight.notFound': 'No encontrada.',
  'insight.title': 'Conclusión',
  'insight.curatedOwn': 'Revisada sobre esta misma versión',
  'insight.curatedInherited': 'Revisada sobre una versión anterior',
  'insight.curatedOn': 'el {date}.',
  'insight.curationDisputed': 'Lo que ha entrado después contradice lo que se decidió.',
  'insight.mattersBecause': 'Afecta a estos objetivos:',
  'insight.evidence': 'En qué se apoya ({count})',
  'insight.decide.title': 'Tu decisión',
  'insight.decide.explain':
    'Lo que decidas manda sobre cualquier recálculo posterior, hasta que lo cambies. Descartarla la retira de la lectura habitual; no borra nada.',
  'insight.decide.field': 'Decisión',
  'insight.decide.confirm': 'La confirmo',
  'insight.decide.correct': 'La corrijo',
  'insight.decide.dismiss': 'La descarto',
  'insight.decide.comment': 'Comentario (opcional)',
  'insight.decide.submit': 'Registrar',
  'insight.decide.done': 'Decisión registrada.',
  'insight.history.show': 'Ver cómo ha cambiado',
  'insight.history.hide': 'Ocultar',
  'insight.history.title': 'Cómo ha cambiado',
  'insight.history.empty': 'No hay ninguna versión que puedas ver.',
  'insight.history.current': 'versión de ahora',
  'insight.history.superseded': 'versión anterior',
  'insight.history.evidenceCount': 'se apoya en {count}',
  'insight.history.confidenceRose': 'Ganó seguridad porque:',
  'insight.history.confidenceFell': 'Perdió seguridad porque:',
  'insight.history.outOfScope':
    'Y {count} cambio(s) más fuera de tu alcance, que no podemos detallarte.',
  'insight.history.hiddenVersions':
    'Hay {count} versión(es) de esta creencia que no puedes ver con tu alcance actual.',
  'insight.change.ENTERED': 'entró información nueva',
  'insight.change.LEFT': 'dejó de sostenerla',
  'insight.change.CONTRADICTED': 'la contradijo',
  'insight.change.SUPERSEDED_EVIDENCE': 'su documento fue sustituido',

  // ── Informes ─────────────────────────────────────────────────────────────
  'reports.new.open': 'Crear informe',
  'reports.new.cancel': 'Cancelar',
  'reports.contains': 'Qué lleva dentro',
  'reports.section.insights': 'Lo que BusinessBrain ha comprendido ({limit} como mucho)',
  'reports.section.search': 'Lo que encuentre sobre «{query}»',
  'reports.generatedTimes': 'Generado {count} vez/veces',
  'reports.neverGenerated': 'Todavía no lo has generado',
  'reports.empty.title': 'Todavía no has creado ningún informe',
  'reports.empty.body':
    'Reúne en un PDF lo que BusinessBrain ha comprendido, con las fuentes de cada afirmación. Para llevarlo a una reunión o enviárselo a tu gestoría.',
  'reports.empty.needsKnowledge':
    'Necesitas al menos un documento leído para que el informe tenga algo que contar.',
  'reports.empty.needsAdmin':
    'Pídele a quien administre BusinessBrain que cree el primero.',
  'reports.title': 'Informes ({count})',
  'reports.new.title': 'Nuevo informe',
  'reports.new.name': 'Nombre del informe',
  'reports.new.namePlaceholder': 'Resumen semanal',
  'reports.new.limit': 'Elementos por sección',
  'reports.new.sectionTitle': 'Título de la sección de comprensión',
  'reports.new.sectionDefault': 'Qué hemos comprendido',
  'reports.new.search': 'Añadir una búsqueda en el conocimiento (opcional)',
  'reports.new.searchHint':
    'Se buscará en tus documentos y se citará lo encontrado.',
  'reports.new.searchPlaceholder': 'política de descuentos',
  'reports.new.searchSection': 'Sobre: {query}',
  'reports.new.submit': 'Guardar informe',
  'reports.runs': 'Generaciones',
  'reports.runs.hide': 'Ocultar',
  'reports.runs.empty': 'Sin generaciones todavía.',
  'reports.download': 'Descargar PDF',
  'reports.downloading': 'Generando…',
  'reports.scopeWarning':
    'El contenido depende de tu alcance: solo incluye lo que tú puedes ver.',
  'reports.notStored':
    'el fichero no se conserva; se regenera cuando hace falta',

  // ── Automatizaciones ─────────────────────────────────────────────────────
  'automations.new.open': 'Crear automatización',
  'automations.new.submit': 'Guardar automatización',
  'automations.new.cancel': 'Cancelar',
  'automations.does': 'Qué hace',
  'automations.next': 'Siguiente vez',
  'automations.never': 'Todavía no se ha ejecutado',
  'automations.ranTimes': 'Se ha ejecutado {count} vez/veces',
  'automations.lastResultAt': 'Última vez el {date}',
  'automations.paused.hint': 'En pausa: no se ejecutará hasta que la reanudes.',
  'automations.error.hint':
    'La última ejecución falló. Revisa las ejecuciones para ver qué pasó.',
  'automations.empty.title': 'Todavía no hay nada que se haga solo',
  'automations.empty.body':
    'Repite sola, a la hora que le digas, lo que ahora haces a mano: volver a leer una web, analizar y generar un informe. Nunca envía nada al exterior.',
  'automations.empty.needsAdmin':
    'Pídele a quien administre BusinessBrain que cree la primera.',
  'automations.title': 'Automatizaciones ({count})',
  'automations.new.title': 'Nueva automatización',
  'automations.new.name': 'Nombre',
  'automations.new.namePlaceholder': 'Barrido semanal',
  'automations.new.when': 'Cuándo',
  'automations.new.timezone': 'Zona horaria: {timezone}',
  'automations.new.whatItDoes': 'Qué hará',
  'automations.new.reread': 'Volver a leer',
  'automations.new.sourceLabel': 'Fuente que se volverá a leer',
  'automations.new.noSource': '(ninguna fuente)',
  'automations.new.analyze': 'Analizar el conocimiento y actualizar la comprensión',
  'automations.new.andReport': 'Y generar el informe',
  'automations.new.noReport': '(ninguno)',
  'automations.new.governance':
    'Una automatización nunca envía nada al exterior ni modifica sistemas: produce comprensión e informes que revisas tú.',
  'automations.schedule.mondays': 'Cada lunes a las 8:00',
  'automations.schedule.daily': 'Todos los días a las 7:00',
  'automations.schedule.monthly': 'El día 1 de cada mes a las 8:00',
  'automations.schedule.every6h': 'Cada 6 horas',
  'automations.runs': 'Ejecuciones',
  'automations.runs.hide': 'Ocultar',
  'automations.runs.empty': 'Sin ejecuciones todavía.',
  'automations.runNow': 'Ejecutar ahora',
  'automations.pause': 'Pausar',
  'automations.resume': 'Reanudar',
  'automations.scheduled': 'Programada ({cron} · {timezone})',
  'automations.manual': 'Manual',
  'automations.action.SYNC_KNOWLEDGE_SOURCE': 'volver a leer la fuente',
  'automations.action.RUN_ANALYSIS': 'analizar',
  'automations.action.GENERATE_REPORT': 'generar informe',

  // ── Conocimiento ─────────────────────────────────────────────────────────
  'knowledge.title': 'Conocimiento de tu empresa',
  'knowledge.subtitle': 'Todo lo que BusinessBrain sabe viene de aquí. Nada se inventa: cada respuesta sale de estos documentos.',
  'knowledge.connect.title': 'Conectar otro origen',
  'knowledge.connect.why':
    'Opcional. Además de subir documentos, BusinessBrain puede leer una carpeta de tu Drive o una etiqueta de tu correo.',
  'knowledge.sources.add': 'Añadir una fuente',
  'knowledge.sources.cancel': 'Cancelar',
  'knowledge.chain.title': 'Cómo funciona',
  'knowledge.chain.sources': 'Fuentes',
  'knowledge.chain.sourcesHint': 'De dónde llega el material: tu ordenador, una web, Drive o Gmail.',
  'knowledge.chain.documents': 'Documentos',
  'knowledge.chain.documentsHint': 'Lo que ha entrado desde esas fuentes.',
  'knowledge.chain.understanding': 'Comprensión',
  'knowledge.chain.understandingHint': 'Documentos ya leídos y listos para consultar.',
  'knowledge.chain.answers': 'Respuestas',
  'knowledge.chain.answersHint': 'Lo que obtienes al preguntar, con sus fuentes.',
  'knowledge.step.origin': 'Paso 1 · De dónde viene',
  'knowledge.step.material': 'Paso 2 · Lo que ya ha entrado',
  'knowledge.goAsk': 'Ir a preguntar',
  'knowledge.collections.title': 'Colecciones',
  'knowledge.collections.why':
    'Una colección delimita quién puede ver qué. Todo documento debe estar en alguna: lo que no pertenece a ninguna no lo ve nadie.',
  'knowledge.collections.empty': 'Ninguna todavía.',
  'knowledge.collections.new': 'Nueva colección',
  'knowledge.collections.placeholder': 'Ventas',

  'knowledge.drive.title': 'Google Drive',
  'knowledge.drive.connected': 'conectado',
  'knowledge.drive.folders': 'carpetas conectadas: {count}',
  'knowledge.drive.permission':
    'BusinessBrain pedirá permiso de SOLO LECTURA sobre tu Drive. Nunca escribe ni modifica nada, y puedes retirarlo cuando quieras.',
  'knowledge.drive.connect': 'Conectar Google Drive',

  'knowledge.gmail.title': 'Gmail',
  'knowledge.gmail.active': 'activa',
  'knowledge.gmail.unknownAccount': 'cuenta no identificada',
  'knowledge.gmail.labels': 'etiquetas conectadas: {count}',
  'knowledge.gmail.revoked': 'revocada',
  'knowledge.gmail.revokedExplain':
    'El acceso a {account} se retiró. Lo que ya se había leído sigue disponible; para volver a recibir correo nuevo, conéctala otra vez.',
  'knowledge.gmail.thatAccount': 'esa cuenta',
  'knowledge.gmail.permission':
    'BusinessBrain pedirá permiso de SOLO LECTURA sobre tu correo. Nunca envía ni modifica nada. Solo entra la etiqueta que elijas, y va a una colección restringida: conectar Gmail no lo abre a toda la empresa.',
  'knowledge.gmail.connect': 'Conectar Gmail',
  'knowledge.disconnect': 'Desconectar',

  'knowledge.sources.title': 'Fuentes de conocimiento',
  'knowledge.sources.empty': 'Ninguna todavía. Crea una para poder subir documentos.',
  'knowledge.sources.kind': 'Tipo de fuente',
  'knowledge.sources.kind.upload': 'Documentos que subo yo',
  'knowledge.sources.kind.website': 'Una página web',
  'knowledge.sources.kind.drive': 'Una carpeta de Google Drive',
  'knowledge.sources.kind.gmail': 'Una etiqueta de Gmail',
  'knowledge.sources.new': 'Nueva fuente',
  'knowledge.sources.namePlaceholder.website': 'Política de descuentos',
  'knowledge.sources.namePlaceholder.upload': 'Documentos de ventas',
  'knowledge.sources.driveFolder': 'Carpeta de Drive',
  'knowledge.sources.driveFolderHint':
    'Se leerá entera la primera vez; después, solo lo que cambie.',
  'knowledge.sources.loadingFolders': 'Cargando carpetas…',
  'knowledge.sources.gmailLabel': 'Etiqueta de Gmail',
  'knowledge.sources.gmailLabelHint':
    'Solo entrará el correo de esta etiqueta. Nada de fuera de ella se sincroniza.',
  'knowledge.sources.loadingLabels': 'Cargando etiquetas…',
  'knowledge.sources.chooseOne': 'Elige una…',
  'knowledge.sources.url': 'Dirección web',
  'knowledge.sources.urlHint':
    'Debe ser accesible desde internet. BusinessBrain la leerá y la volverá a leer cuando lo pidas.',
  'knowledge.sources.urlPlaceholder':
    'https://ejemplo.com/politica-de-descuentos',
  'knowledge.sources.collection': 'Colección de destino',
  'knowledge.sources.collectionHint':
    'Sin colección, lo que subas no lo verá nadie.',
  'knowledge.sources.collectionHintGmail':
    'El correo exige una colección RESTRINGIDA: elige una a la que no tenga acceso toda la organización.',
  'knowledge.sources.create': 'Crear fuente',

  'knowledge.source.lastSync': 'última lectura {date}',
  'knowledge.source.stats': 'nuevos: {created} · actualizados: {updated}',
  'knowledge.source.statsFailed': ' · no se pudieron leer: {failed}',
  'knowledge.source.notRetrievable':
    '{count} no se pueden consultar todavía: vuelve a leer la fuente',
  'knowledge.source.syncing': 'Leyendo…',
  'knowledge.source.readPage': 'Leer la página',
  'knowledge.source.sync': 'Volver a leer',
  'knowledge.source.uploading': 'Subiendo…',
  'knowledge.source.upload': 'Subir documento',
  'knowledge.upload.failed':
    'No hemos podido subir este documento. Revísalo y vuelve a intentarlo.',
  'knowledge.upload.unreadable':
    'No hemos podido leer {file}. Revísalo y vuelve a intentarlo.',
  'knowledge.upload.indexed': '{file} ya está dentro y se puede preguntar.',
  'knowledge.upload.duplicate': '{file} ya estaba: no se ha duplicado.',

  'knowledge.items.title': 'Documentos ({count})',
  'knowledge.items.empty': 'Todavía no ha entrado ningún documento.',
  'knowledge.items.column.title': 'Título',
  'knowledge.items.column.area': 'Área',
  'knowledge.items.column.status': 'Estado',
  'knowledge.items.column.confidence': 'Fiabilidad',
  'knowledge.items.column.indexed': 'Añadido',
  'knowledge.items.missingAtSource': 'ya no está en su origen',

  // ── Configuración: IA ────────────────────────────────────────────────────
  'ai.title': 'Inteligencia artificial',
  'ai.ready': 'lista',
  'ai.notConfigured': 'sin configurar',
  'ai.adminOnly': 'Solo un administrador puede cambiar esta configuración.',
  'ai.provider': 'Proveedor',
  'ai.replaceKey': 'Sustituir la clave',
  'ai.keyFor': 'Clave de {provider}',
  'ai.yourProvider': 'tu proveedor',
  'ai.keyHint':
    'Empieza por "{prefix}". La comprobamos antes de guardarla y no se muestra nunca más.',
  'ai.checking': 'Comprobando…',
  'ai.saveAndCheck': 'Guardar y comprobar',
  'ai.removeKey': 'Quitar mi clave',
  'ai.noKey': '¿No tienes clave?',
  'ai.createKey': 'Créala en tu cuenta de {provider}',
  'ai.billedToYou': 'El consumo se factura en tu cuenta, no en BusinessBrain.',
  'ai.explanation.OWN_KEY':
    'BusinessBrain usa la clave de tu empresa. El consumo se factura en tu cuenta del proveedor.',
  'ai.explanation.OWN_PROFILE_PLATFORM_KEY':
    'Tu empresa tiene un modelo elegido, pero usa la clave incluida en el servicio.',
  'ai.explanation.PLATFORM':
    'BusinessBrain está usando la inteligencia artificial incluida en el servicio. Puedes poner la clave de tu empresa si prefieres usar tu propia cuenta.',
  'ai.explanation.NOT_CONFIGURED':
    'Falta configurar la inteligencia artificial. Sin ella BusinessBrain no puede leer tus documentos ni responder preguntas.',

  // ── Configuración: uso de IA ─────────────────────────────────────────────
  'aiUsage.title': 'Uso de IA de hoy',
  'aiUsage.label': 'Uso de IA de hoy',
  'aiUsage.summary':
    'Equivale a unas {used} páginas de {limit} disponibles hoy. El contador vuelve a cero cada día.',
  'aiUsage.reached':
    'Has llegado al tope de hoy. Es una protección para que no te lleves un susto con la factura de tu proveedor de IA.',
  'aiUsage.limit': 'Tope diario (páginas)',
  'aiUsage.limitHint': 'Súbelo si a tu equipo se le queda corto.',
  'aiUsage.save': 'Guardar tope',
  'aiUsage.saved': 'Tope guardado.',

  // ── Configuración: organización y personas ───────────────────────────────
  'settings.org.title': 'Organización',
  'settings.org.name': 'Nombre',
  'settings.org.slug': 'Nombre corto',
  'settings.org.yourRole': 'Tu rol',
  'settings.members.title': 'Miembros ({count})',
  'settings.members.column.name': 'Nombre',
  'settings.members.column.email': 'Correo',
  'settings.members.column.role': 'Rol',
  'settings.reliability.title': 'Exigencia con tus fuentes',
  'settings.reliability.explain':
    'Por debajo de este nivel de fiabilidad, BusinessBrain marcará un documento para que alguien lo revise. Un número entre 0 y 1: cuanto más alto, más exigente.',
  'settings.reliability.field': 'Exigencia de fiabilidad',
  'settings.reliability.save': 'Guardar exigencia',
  'settings.reliability.saved': 'Exigencia guardada.',
  'settings.invite.title': 'Invitar a alguien',
  'settings.invite.explain':
    'Se crea un enlace de invitación. Cópialo y mándaselo por donde ya habléis. Solo funcionará para esa dirección.',
  'settings.invite.email': 'Correo de la persona',
  'settings.invite.emailPlaceholder': 'companero@tuempresa.com',
  'settings.invite.role': 'Rol',
  'settings.invite.roleHint':
    'Solo lectura solo lee; miembro puede preguntar y curar.',
  'settings.invite.submit': 'Crear invitación',
  'settings.invite.linkTitle':
    'Enlace de invitación. Caduca, y solo sirve para el correo indicado:',
  'settings.access.title': 'Quién ve qué',
  'settings.access.explain':
    'El acceso a una colección determina qué comprensión puede leer una persona. Si no cubre TODAS las colecciones en las que se apoya una conclusión, no la ve — el acceso parcial deniega.',
  'settings.access.noCollections':
    'Crea una colección en Conocimiento para empezar.',
  'settings.access.nobody': 'Nadie tiene acceso todavía.',
  'settings.access.grantTo': 'Conceder acceso a',
  'settings.access.choose': 'Elige a alguien…',
  'settings.access.grant': 'Conceder',
  'settings.access.revoke': 'retirar',
  'settings.access.revokeTitle': 'Retirar acceso',

  // ── Configuración: privacidad ────────────────────────────────────────────
  'privacy.title': 'Tus datos y la inteligencia artificial',
  'privacy.outgoing.title':
    'Qué sale hacia el proveedor de IA que has configurado',
  'privacy.outgoing.explain':
    'Para leer tus documentos y responder tus preguntas, BusinessBrain envía el texto necesario al proveedor de IA. Esto es exactamente lo que sale y cuándo:',
  'privacy.stored.title': 'Qué guarda BusinessBrain',
  'privacy.pending.title': 'Todavía pendiente',
  'privacy.export.title': 'Llévate una copia',
  'privacy.export.explain':
    'Un fichero con tus documentos, tus conversaciones, tus conclusiones y tus recomendaciones. No incluye tu clave del proveedor de IA ni ninguna credencial.',
  'privacy.export.button': 'Descargar mis datos',
  'privacy.export.busy': 'Preparando…',
  'privacy.erase.title': 'Borrar todo',
  'privacy.erase.explain':
    'Se borran los documentos, las conversaciones, las conclusiones, las recomendaciones y la configuración de esta empresa. No se puede deshacer. Las cuentas de las personas no se borran: pueden pertenecer a otra empresa.',
  'privacy.erase.open': 'Quiero borrar los datos de esta empresa',
  'privacy.erase.confirmLabel': 'Escribe «{name}» para confirmar',
  'privacy.erase.confirmHint':
    'Exactamente igual, incluidas mayúsculas y acentos.',
  'privacy.erase.submit': 'Borrar definitivamente',
  'privacy.erase.busy': 'Borrando…',

  // ── Qué sale hacia el proveedor de IA ────────────────────────────────────
  //
  // El backend declara las salidas y una prueba estructural impide que aparezca una sin
  // declarar. Aquí se dicen en el idioma de quien mira; si faltara una traducción, se muestra
  // la frase que manda el servidor.
  'privacy.flow.ASK.what':
    'Tu pregunta y los fragmentos de tus documentos que se han encontrado para responderla.',
  'privacy.flow.ASK.trigger': 'Cada vez que alguien pregunta algo.',
  'privacy.flow.ASK_STREAM.what':
    'Lo mismo que al preguntar, cuando la respuesta se va escribiendo sobre la marcha.',
  'privacy.flow.ASK_STREAM.trigger': 'Cada vez que alguien pregunta algo.',
  'privacy.flow.CLASSIFY.what':
    'Un fragmento de cada documento, para saber de qué área de la empresa trata.',
  'privacy.flow.CLASSIFY.trigger': 'Al incorporar un documento nuevo.',
  'privacy.flow.EMBED.what':
    'El texto completo de cada documento, troceado, para poder buscarlo después.',
  'privacy.flow.EMBED.trigger': 'Al incorporar un documento nuevo.',
  'privacy.flow.SEARCH.what':
    'El texto de la búsqueda, para poder compararlo con tus documentos.',
  'privacy.flow.SEARCH.trigger': 'Cada vez que se busca algo en tu conocimiento.',
  'privacy.flow.SYNTHESIS.what':
    'El contenido de los documentos que se están analizando.',
  'privacy.flow.SYNTHESIS.trigger': 'Al lanzar un análisis.',
  'privacy.flow.PROPOSE.what':
    'Las conclusiones del análisis, para redactar una recomendación.',
  'privacy.flow.PROPOSE.trigger': 'Al lanzar un análisis.',
  'privacy.flow.CONNECTION_TEST.what':
    'Una frase de prueba, sin datos tuyos, para comprobar que la clave funciona.',
  'privacy.flow.CONNECTION_TEST.trigger': 'Al guardar la configuración de la IA.',

  'privacy.stored.DOCUMENTS.what':
    'Los documentos que subes o que se leen de tus fuentes',
  'privacy.stored.DOCUMENTS.detail':
    'Su texto completo, para poder responder con citas. Se guarda dentro de BusinessBrain.',
  'privacy.stored.CONVERSATIONS.what': 'Las preguntas y respuestas',
  'privacy.stored.CONVERSATIONS.detail':
    'Para que puedas volver a una conversación anterior.',
  'privacy.stored.CONCLUSIONS.what': 'Las conclusiones y recomendaciones',
  'privacy.stored.CONCLUSIONS.detail':
    'Con la evidencia de la que salen, para que siempre se puedan comprobar.',
  'privacy.stored.PEOPLE.what': 'Quién hace qué',
  'privacy.stored.PEOPLE.detail':
    'Nombre, correo y las decisiones que toma cada persona sobre una recomendación.',
  'privacy.stored.AI_KEY.what': 'Tu clave del proveedor de IA',
  'privacy.stored.AI_KEY.detail':
    'Cifrada. No se puede leer desde la interfaz ni vuelve nunca en una respuesta.',

  'privacy.pending.DPA':
    'El contrato de encargado de tratamiento con el proveedor de IA depende de con cuál trabaje cada empresa y de una revisión jurídica. Todavía no se entrega desde aquí.',
  'privacy.pending.RETENTION':
    'El plazo de conservación de los datos tras una baja no está fijado: hoy, si pides el borrado, se borra en ese momento.',

  // ── Auditoría de plataforma ──────────────────────────────────────────────
  //
  // Lo que ha hecho quien administra BusinessBrain. La API manda CÓDIGOS —`platform.user.banned`
  // es vocabulario de un catálogo interno— y aquí se dicen en la lengua de quien mira. Ningún
  // código puede llegar nunca a la pantalla: hay una prueba que comprueba que todos tienen
  // traducción, en los dos idiomas.
  'audit.action.platform.users.listed': 'Consultó la lista de personas',
  'audit.action.platform.user.banned': 'Bloqueó una cuenta',
  'audit.action.platform.user.unbanned': 'Desbloqueó una cuenta',
  'audit.action.platform.organization.plan_changed': 'Cambió el plan de una empresa',

  'audit.action.platform.access.requested': 'Pidió acceso a los datos de una empresa',
  'audit.action.platform.access.approved': 'Aprobó el acceso a los datos de su empresa',
  'audit.action.platform.access.used': 'Consultó datos de una empresa',
  'audit.action.platform.access.revoked': 'Retiró el acceso a los datos de una empresa',

  'audit.target.User': 'cuenta',
  'audit.target.Organization': 'empresa',
  'audit.target.PlatformAccessGrant': 'acceso autorizado',

  'audit.detail.scope': 'alcance',
  'audit.detail.reason': 'motivo',
  'audit.detail.what': 'qué se consultó',
  'audit.detail.expiresAt': 'caduca',
  'audit.detail.requiresApproval': 'necesita aprobación',

  'audit.value.METADATA': 'datos generales',
  'audit.value.DIAGNOSTICS': 'diagnóstico',
  'audit.value.CONTENT': 'contenido',

  'audit.detail.previousStatus': 'estado anterior',
  'audit.detail.newStatus': 'estado nuevo',
  'audit.detail.from': 'antes',
  'audit.detail.to': 'después',
  'audit.detail.page': 'página',
  'audit.detail.returned': 'personas mostradas',

  'audit.value.ACTIVE': 'activa',
  'audit.value.BANNED': 'bloqueada',
  'audit.value.FREE': 'Gratuito',
  'audit.value.PRO': 'Profesional',
  'audit.value.ENTERPRISE': 'Empresa',

  // ── Verificación en dos pasos ─────────────────────────────────────────────
  //
  // Ni una palabra del vocabulario interno. Quien lee esto tiene una gestoría, no un equipo de
  // seguridad: "TOTP", "secreto" y "recovery code" no le dicen nada, y "código de un solo uso"
  // y "códigos de repuesto" le dicen exactamente lo que son.
  'mfa.title': 'Verificación en dos pasos',
  'mfa.explain':
    'Además de tu contraseña, para entrar te pediremos un código que cambia cada pocos segundos en tu móvil. Si alguien consigue tu contraseña, sigue sin poder entrar.',
  'mfa.status.on': 'Activada',
  'mfa.status.off': 'Desactivada',
  'mfa.status.since': 'Activada el {date}',
  'mfa.status.pending':
    'Empezaste a configurarla y quedó a medias. Vuelve a empezar para terminarla.',
  'mfa.status.remaining':
    'Te quedan {count} códigos de repuesto sin usar.',
  'mfa.status.lowCodes':
    'Te quedan {count} códigos de repuesto. Conviene generar unos nuevos.',
  'mfa.activate': 'Activar',
  'mfa.deactivate': 'Desactivar',
  'mfa.setup.step1':
    'Abre tu aplicación de autenticación en el móvil (Google Authenticator, Microsoft Authenticator, o la que ya uses) y escanea este código.',
  'mfa.setup.qrAlt': 'Código para escanear con tu aplicación',
  'mfa.setup.manual': '¿No puedes escanearlo? Escribe esta clave a mano:',
  'mfa.setup.step2':
    'Escribe el código de 6 dígitos que te muestra la aplicación:',
  'mfa.setup.code': 'Código de 6 dígitos',
  'mfa.setup.confirm': 'Confirmar y activar',
  'mfa.setup.cancel': 'Dejarlo para luego',
  'mfa.codes.title': 'Guarda estos códigos de repuesto',
  'mfa.codes.explain':
    'Si algún día pierdes el móvil, cada uno de estos códigos te deja entrar una vez. Imprímelos o guárdalos en un sitio seguro: no vamos a poder volver a enseñártelos.',
  'mfa.codes.understood': 'Los he guardado',
  'mfa.codes.regenerate': 'Generar códigos nuevos',
  'mfa.codes.regenerateHint':
    'Los códigos anteriores dejarán de funcionar.',
  'mfa.login.title': 'Un paso más',
  'mfa.login.explain':
    'Escribe el código que te muestra tu aplicación de autenticación.',
  'mfa.login.code': 'Código',
  'mfa.login.hint':
    '¿No tienes el móvil? Escribe aquí uno de tus códigos de repuesto.',
  'mfa.login.submit': 'Entrar',
  'mfa.remove.title': 'Retirar la verificación de un administrador',
  'mfa.remove.explain':
    'Si alguien de tu equipo ha perdido el móvil y sus códigos de repuesto, puedes retirarle la verificación en dos pasos. Seguirá necesitando su contraseña para entrar.',
  'mfa.remove.submit': 'Retirar',
  'mfa.remove.done':
    'Listo. Le hemos avisado por correo y ya puede entrar solo con su contraseña.',

  // ── Confirmar identidad antes de una acción delicada ──────────────────────
  'reauth.title': 'Confirma que eres tú',
  'reauth.explain':
    'Vas a hacer algo importante y hace un rato que entraste. Confírmanos que sigues siendo tú.',
  'reauth.code': 'Código de tu aplicación',
  'reauth.password': 'Tu contraseña',
  'reauth.submit': 'Confirmar',
  'reauth.cancel': 'Cancelar',
  'reauth.done': 'Confirmado. Puedes seguir.',

  // ── Cambiar la contraseña desde dentro ────────────────────────────────────
  'password.title': 'Contraseña',
  'password.explain':
    'Al cambiarla, se cerrarán las sesiones abiertas en otros dispositivos.',
  'password.new': 'Contraseña nueva',
  'password.repeat': 'Repítela',
  'password.mismatch': 'Las dos contraseñas no coinciden.',
  'password.submit': 'Cambiar contraseña',
  'password.done': 'Contraseña cambiada.',

  'audit.action.mfa.enabled': 'Activó la verificación en dos pasos',
  'audit.action.mfa.disabled': 'Desactivó la verificación en dos pasos',
  'audit.action.platform.user.mfa_removed':
    'Retiró la verificación en dos pasos de una cuenta',
  'audit.detail.targetName': 'sobre',
  'audit.detail.organizations': 'empresas afectadas',
  'audit.detail.recoveryCodesIssued': 'códigos entregados',
  'audit.detail.method': 'con qué',
  'audit.detail.sensitiveAction': 'acción intentada',
  'audit.detail.otherSessionsRevoked': 'cerró las demás sesiones',
  'audit.detail.remainingCodes': 'códigos restantes',
  'audit.detail.requestedById': 'lo pidió',

  // ══ PANEL DE OPERACIÓN ═════════════════════════════════════════════════════
  //
  // Vocabulario deliberado: aquí no aparece "tenant", ni "grant", ni "scope", ni "SUPERADMIN".
  // Quien lee esto opera un producto, y las palabras del esquema no le ayudan a decidir nada.
  'platform.chrome.badge': 'Operación',
  'platform.chrome.boundary':
    'Administras BusinessBrain. Los datos de cada empresa siguen siendo suyos: para consultarlos hace falta un acceso motivado, con fecha de fin y visible para el cliente.',

  'platform.nav.assistant': 'Asistente',
  'platform.nav.account': 'Mi cuenta',

  // ── Asistente de operación ────────────────────────────────────────────────
  'platform.assistant.title': 'Asistente de operación',
  'platform.assistant.subtitle':
    'Pregunta sobre el estado de la plataforma y de tus clientes. Consulta lo mismo que puedes consultar tú, con tus mismos permisos, y no ejecuta nada.',
  'platform.assistant.startHere': 'Por dónde empezar',
  'platform.assistant.startHint':
    'Escribe tu pregunta abajo, o prueba con una de estas.',
  'platform.assistant.example.health':
    '¿Cómo está la plataforma ahora mismo?',
  'platform.assistant.example.quiet':
    '¿Qué empresas llevan tiempo sin subir nada?',
  'platform.assistant.example.recent':
    '¿Qué se ha hecho desde administración esta semana?',
  'platform.assistant.ask': 'Preguntar',
  'platform.assistant.placeholder':
    'Por ejemplo: ¿qué clientes tienen el plan gratuito y más de cien documentos?',
  'platform.assistant.thinking': 'Consultando…',
  'platform.assistant.failed':
    'No se ha podido responder. Vuelve a intentarlo en un momento.',
  'platform.assistant.neverExecutes':
    'El asistente propone; ejecutar es cosa tuya.',
  'platform.assistant.consulted': 'Ha consultado',
  'platform.assistant.consultedNothing':
    'No ha consultado nada: esta respuesta no se apoya en datos.',
  'platform.assistant.outcome.NEEDS_GRANT': 'Sin acceso concedido',
  'platform.assistant.outcome.UNKNOWN_TOOL': 'No puede hacer eso',
  'platform.assistant.currentAccess': 'Tus accesos abiertos',
  'platform.assistant.currentAccessHint':
    'El asistente solo alcanza lo que tú tienes concedido ahora mismo.',
  'platform.assistant.noAccess':
    'Ninguno. Puede responderte sobre la plataforma, pero no sobre lo que hay dentro de una empresa.',
  'platform.assistant.canConsult': 'Qué puede consultar',
  'platform.assistant.needsScope': 'Necesita un acceso de tipo «{scope}».',
  'platform.assistant.cannot': 'Qué no puede hacer',
  'platform.assistant.cannotHint':
    'No puede leer los documentos de ninguna empresa, ni cambiar nada, ni conceder accesos, ni usar los de otra persona. No es que se le deniegue: no existen esas capacidades.',
  'platform.assistant.asWho': 'Consulta como {who}.',
  'platform.assistant.tool.platform_overview':
    'El estado general de la plataforma',
  'platform.assistant.tool.list_organizations': 'La lista de empresas',
  'platform.assistant.tool.organization_metadata':
    'Los datos generales de una empresa',
  'platform.assistant.tool.organization_diagnostics':
    'El diagnóstico de una empresa',
  'platform.assistant.tool.my_access': 'Tus accesos abiertos',
  'platform.assistant.tool.platform_audit': 'El registro de administración',
  'platform.account.title': 'Mi cuenta',
  'platform.account.subtitle': 'La verificación en dos pasos es obligatoria para administrar BusinessBrain: sin ella no podrás usar el resto del panel.',
  'platform.nav.overview': 'Inicio',
  'platform.nav.organizations': 'Empresas',
  'platform.nav.users': 'Personas',
  'platform.nav.access': 'Mis accesos',
  'platform.nav.audit': 'Registro',

  // ── Estados de pantalla ───────────────────────────────────────────────────
  'platform.state.loading': 'Cargando…',
  'platform.state.empty': 'No hay nada que mostrar todavía.',
  'platform.state.error': 'No se ha podido cargar esta información.',
  'platform.state.errorHint':
    'Puede ser un problema momentáneo de conexión. Vuelve a intentarlo; si sigue fallando, revisa el estado del servicio.',
  'platform.state.retry': 'Reintentar',

  'platform.pagination.label': 'Paginación',
  'platform.pagination.previous': 'Anterior',
  'platform.pagination.next': 'Siguiente',
  'platform.pagination.position': 'Página {page} de {pages}',

  // ── Inicio ────────────────────────────────────────────────────────────────
  'platform.overview.title': 'Estado de la plataforma',
  'platform.overview.subtitle':
    'Lo que hay abierto ahora mismo y el tamaño del producto. Nada de aquí procede de los documentos de ningún cliente.',
  'platform.overview.openAccess': 'Accesos abiertos a datos de clientes',
  'platform.overview.openAccessHint':
    'Lo primero que conviene mirar cada día: lo que sigue abierto y ya no hace falta.',
  'platform.overview.noOpenAccess':
    'No tienes ningún acceso abierto a los datos de ninguna empresa.',
  'platform.overview.seeAll': 'Ver todos',
  'platform.overview.organizations': 'Empresas',
  'platform.overview.people': 'Personas',
  'platform.overview.blocked': 'Cuentas bloqueadas',
  'platform.overview.blockedHint': 'No pueden entrar',
  'platform.overview.byPlan': 'Empresas por plan',

  // ── Empresas ──────────────────────────────────────────────────────────────
  'platform.organizations.title': 'Empresas',
  'platform.organizations.subtitle':
    'Tu cartera de clientes. Los recuentos dicen cuánto material maneja cada uno; para ver qué contiene hace falta pedir acceso.',
  'platform.organizations.search': 'Buscar',
  'platform.organizations.searchPlaceholder': 'Nombre o identificador',
  'platform.organizations.searchScope':
    'La búsqueda se aplica solo a las empresas de esta página. Cambia de página para buscar en el resto.',
  'platform.organizations.plan': 'Plan',
  'platform.organizations.allPlans': 'Todos',
  'platform.organizations.none': 'Todavía no hay ninguna empresa.',
  'platform.organizations.noMatches': 'Ninguna empresa coincide con la búsqueda.',
  'platform.organizations.column.name': 'Empresa',
  'platform.organizations.column.plan': 'Plan',
  'platform.organizations.column.people': 'Personas',
  'platform.organizations.column.documents': 'Documentos',
  'platform.organizations.column.sources': 'Fuentes',
  'platform.organizations.column.since': 'Cliente desde',

  'platform.plan.FREE': 'Gratuito',
  'platform.plan.PRO': 'Profesional',
  'platform.plan.ENTERPRISE': 'Empresa',
  'platform.plan.change': 'Cambiar de plan',
  'platform.plan.apply': 'Aplicar',
  'platform.plan.confirmTitle': 'Cambiar el plan de esta empresa',
  'platform.plan.confirmBody':
    'El plan pasará de «{from}» a «{to}». El cambio es inmediato y afecta a la cuenta del cliente.',

  // ── Ficha de empresa ──────────────────────────────────────────────────────
  'platform.organization.back': '← Empresas',
  'platform.organization.subtitle': 'Identificador: {slug}',
  'platform.organization.plan': 'Plan',
  'platform.organization.since': 'Cliente desde',
  'platform.organization.theirData': 'Sus datos',
  'platform.organization.theirDataHint':
    'A partir de aquí empieza lo que pertenece a la empresa. Cada apartado necesita su propio acceso, con motivo y fecha de fin, y el cliente puede ver quién entró y cuándo.',

  // ── Los tres alcances ─────────────────────────────────────────────────────
  'platform.scope.METADATA.name': 'Datos generales',
  'platform.scope.METADATA.explains':
    'Cuántos documentos y colecciones tiene, qué fuentes ha conectado y si están sincronizando. Ni una línea de lo que dicen sus documentos.',
  'platform.scope.METADATA.request': 'Pedir acceso a los datos generales',
  'platform.scope.METADATA.confirmTitle': 'Pedir acceso a los datos generales',
  'platform.scope.METADATA.confirmBody':
    'Vas a poder ver cuántos documentos y fuentes tiene esta empresa y en qué estado están. No verás el contenido de ningún documento. El acceso dura 24 horas y lo pides tú ({who}); la empresa lo verá en su registro con el motivo que escribas.',

  'platform.scope.DIAGNOSTICS.name': 'Diagnóstico',
  'platform.scope.DIAGNOSTICS.explains':
    'Los errores técnicos: qué sincronización falló y por qué. Puede citar el nombre de un fichero para poder identificarlo, nunca su contenido.',
  'platform.scope.DIAGNOSTICS.request': 'Pedir acceso al diagnóstico',
  'platform.scope.DIAGNOSTICS.confirmTitle': 'Pedir acceso al diagnóstico',
  'platform.scope.DIAGNOSTICS.confirmBody':
    'Vas a poder ver los errores técnicos de esta empresa, incluido el nombre del fichero que falló cuando haga falta para identificarlo. No verás el contenido de ningún documento. El acceso dura 24 horas y lo pides tú ({who}); la empresa lo verá en su registro con el motivo que escribas.',

  'platform.scope.CONTENT.name': 'Contenido',
  'platform.scope.CONTENT.explains':
    'El texto de los documentos de la empresa. Es lo que ellos escribieron, y por eso lo tiene que aprobar quien responde por la empresa.',
  'platform.scope.CONTENT.request': 'Pedir acceso al contenido',
  'platform.scope.CONTENT.confirmTitle': 'Pedir acceso al contenido de esta empresa',
  'platform.scope.CONTENT.confirmBody':
    'Vas a pedir poder LEER los documentos de esta empresa: contratos, informes, correos, lo que hayan subido. La petición queda pendiente y no se abre nada hasta que la apruebe quien responde por la empresa. Si la aprueba, el acceso dura como máximo 72 horas, cada documento que abras queda registrado uno a uno, y el cliente puede verlo. Lo pides tú ({who}) con el motivo que escribas.',

  'platform.scope.open': 'Acceso activo',
  'platform.scope.closed': 'Sin acceso',
  'platform.scope.awaitingOwner': 'Esperando a la empresa',
  'platform.scope.expires': 'Caduca {when}',
  'platform.scope.reasonGiven': 'Motivo: {reason}',
  'platform.scope.revoke': 'Retirar este acceso',
  'platform.scope.revokeTitle': 'Retirar el acceso',
  'platform.scope.revokeConsequence':
    'Dejarás de poder consultar «{scope}» de esta empresa inmediatamente. Puedes volver a pedirlo cuando haga falta.',
  'platform.scope.pendingExplain':
    'Has pedido este acceso y {organization} todavía no lo ha aprobado. Hasta que lo haga, no puedes consultar nada.',
  'platform.scope.pendingExpires': 'La petición caduca {when} si nadie responde.',
  'platform.scope.reasonLabel': 'Por qué lo necesitas',
  'platform.scope.reasonHint':
    'Lo verá la empresa en su registro. Explícalo como se lo explicarías a ellos.',

  'platform.grant.status.PENDING': 'Pendiente de aprobación',
  'platform.grant.status.ACTIVE': 'Activo',
  'platform.grant.status.REVOKED': 'Retirado',
  'platform.grant.status.EXPIRED': 'Caducado',
  'platform.grant.expiredAlready': 'ya caducado',

  'platform.metadata.collections': 'Colecciones',
  'platform.metadata.insights': 'Conclusiones',
  'platform.metadata.source': 'Fuente',
  'platform.metadata.state': 'Estado',
  'platform.metadata.lastSync': 'Última sincronización',

  'platform.diagnostics.failingSources': 'Fuentes con error',
  'platform.diagnostics.recentJobs': 'Últimas sincronizaciones',
  'platform.diagnostics.failedAnalyses': 'Análisis fallidos',
  'platform.diagnostics.state': 'Estado',
  'platform.diagnostics.detail': 'Detalle técnico',
  'platform.diagnostics.when': 'Cuándo',

  'platform.content.title': 'Documento',
  'platform.content.state': 'Estado',
  'platform.content.indexed': 'Indexado',
  'platform.content.read': 'Abrir',
  'platform.content.close': 'Cerrar',
  'platform.content.readLogged':
    'La apertura de este documento ha quedado registrada, y la empresa puede verla.',

  'platform.grantHistory.title': 'Historial de accesos a esta empresa',
  'platform.grantHistory.hint':
    'Lo mismo que ve el cliente desde su cuenta. Incluye los caducados y los retirados.',
  'platform.grantHistory.none': 'Nunca se ha pedido acceso a esta empresa.',
  'platform.grantHistory.scope': 'Alcance',
  'platform.grantHistory.state': 'Estado',
  'platform.grantHistory.reason': 'Motivo',
  'platform.grantHistory.requestedBy': 'Lo pidió',
  'platform.grantHistory.requestedAt': 'Pedido',
  'platform.grantHistory.expires': 'Caduca',

  // ── Personas ──────────────────────────────────────────────────────────────
  'platform.users.title': 'Personas',
  'platform.users.subtitle':
    'Las cuentas de todas las empresas clientes. Sirve para atender «no puedo entrar», no para otra cosa.',
  'platform.users.readLogged':
    'Consultar esta lista queda registrado: son datos personales de empleados de empresas clientes.',
  'platform.users.search': 'Buscar por nombre o correo',
  'platform.users.none': 'No hay ninguna cuenta que mostrar.',
  'platform.users.isAdmin': 'Administración',
  'platform.users.column.name': 'Nombre',
  'platform.users.column.email': 'Correo',
  'platform.users.column.state': 'Estado',
  'platform.users.column.mfa': 'Verificación en dos pasos',
  'platform.users.column.lastSeen': 'Última actividad',
  'platform.users.status.ACTIVE': 'Activa',
  'platform.users.status.BANNED': 'Bloqueada',
  'platform.users.mfaOn': 'Activada',
  'platform.users.mfaOff': 'Desactivada',

  'platform.user.back': '← Personas',
  'platform.user.account': 'La cuenta',
  'platform.user.since': 'Se registró',
  'platform.user.organizations': 'Empresas a las que pertenece',
  'platform.user.noOrganizations': 'No pertenece a ninguna empresa.',
  'platform.user.noOrganizationsAdmin':
    'Ninguna, y no puede pertenecer a ninguna: es una cuenta de administración de BusinessBrain.',
  'platform.user.actions': 'Acciones sobre esta cuenta',
  'platform.user.actionsHint':
    'Todas quedan registradas y algunas te pedirán confirmar tu identidad.',
  'platform.user.cannotActOnAdmin':
    'Es una cuenta de administración de BusinessBrain. No se puede bloquear desde aquí: dejaría el producto sin nadie que pudiera desbloquearla.',
  'platform.user.ban': 'Bloquear la cuenta',
  'platform.user.banTitle': 'Bloquear esta cuenta',
  'platform.user.banBody':
    'Esta persona dejará de poder entrar inmediatamente, y sus sesiones abiertas se cortarán. Su empresa y sus documentos no se tocan. Puedes desbloquearla después.',
  'platform.user.unban': 'Desbloquear la cuenta',
  'platform.user.unbanTitle': 'Desbloquear esta cuenta',
  'platform.user.unbanBody':
    'Esta persona podrá volver a entrar con su contraseña habitual.',
  'platform.user.removeMfa': 'Retirar la verificación en dos pasos',
  'platform.user.removeMfaTitle': 'Retirar la verificación en dos pasos',
  'platform.user.removeMfaBody':
    'Esta persona dejará de necesitar el código de su móvil para entrar. NO te da acceso a su cuenta: seguirá haciendo falta su contraseña, que ni se lee ni se cambia aquí. Le avisaremos por correo, y también a quien responde por su empresa.',
  'platform.user.removeMfaReason': 'Por qué hace falta retirarla',
  'platform.user.removeMfaReasonHint':
    'Aparecerá en el correo que recibe esa persona y en el registro. Al menos 10 caracteres.',

  // ── Mis accesos ───────────────────────────────────────────────────────────
  'platform.myAccess.title': 'Mis accesos',
  'platform.myAccess.subtitle':
    'Lo que tienes abierto ahora mismo sobre los datos de otras empresas, y lo que has tenido antes.',
  'platform.myAccess.notMembership':
    'Tener un acceso no es pertenecer a esa empresa. Son permisos temporales de lectura sobre datos que no son tuyos, y conviene retirarlos en cuanto dejen de hacer falta.',
  'platform.myAccess.open': 'Abiertos ahora',
  'platform.myAccess.noneOpen': 'No tienes ningún acceso abierto.',
  'platform.myAccess.expires': 'Caduca {when}',
  'platform.myAccess.requestedAt': 'Pedido el {when}',
  'platform.myAccess.approvedBy': 'aprobado por {who}',
  'platform.myAccess.finished': 'Terminados',
  'platform.myAccess.finishedHint':
    'Accesos que ya caducaron o que retiraste. Se conservan porque son parte del historial que el cliente puede consultar.',

  // ── Registro ──────────────────────────────────────────────────────────────
  'platform.audit.title': 'Registro de administración',
  'platform.audit.subtitle':
    'Todo lo que se ha hecho desde la administración de BusinessBrain. La actividad de cada empresa no aparece aquí: es suya.',
  'platform.audit.filterByAction': 'Filtrar por acción',
  'platform.audit.allActions': 'Todas las acciones',
  'platform.audit.none': 'Todavía no hay ninguna acción registrada.',
  'platform.audit.system': 'El sistema',

  // ── Confirmación de acciones sensibles ────────────────────────────────────
  'platform.confirm.reason': 'Motivo',
  'platform.confirm.reasonHint': 'Quedará en el registro. Al menos 10 caracteres.',
  'platform.confirm.audited':
    'Esta acción quedará registrada con tu nombre, la fecha y el motivo.',
  'platform.confirm.cancel': 'Cancelar',
  'platform.confirm.done': 'Hecho. Ha quedado registrado.',
  'platform.confirm.denied':
    'No tienes permiso para hacer esto, o la acción ya no es posible en este estado.',
  'platform.confirm.invalid':
    'Faltan datos o alguno no es válido. Revisa lo que has escrito.',
  'platform.confirm.failed':
    'No se ha podido completar. Vuelve a intentarlo en un momento.',
} as const;

/** Las claves que existen. Una pantalla que pida otra cosa no compila. */
export type TranslationKey = keyof typeof es;

/** Un catálogo completo. Los idiomas nuevos pueden entrar como `Partial<Catalog>`. */
export type Catalog = Record<TranslationKey, string>;
