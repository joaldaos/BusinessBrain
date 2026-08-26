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

  // ── Navegación ───────────────────────────────────────────────────────────
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
  'status.knowledgeItem.PENDING': 'en cola',
  'status.knowledgeItem.PROCESSING': 'procesando',
  'status.knowledgeItem.INDEXED': 'listo',
  'status.knowledgeItem.FAILED': 'con problemas',
  'status.knowledgeItem.SUPERSEDED': 'versión anterior',
  'status.knowledgeItem.DELETED': 'eliminado',

  'status.insightType.PATTERN': 'patrón',
  'status.insightType.ANOMALY': 'desviación',
  'status.insightType.RISK': 'riesgo',
  'status.insightType.OPPORTUNITY': 'oportunidad',

  'status.freshness.FRESH': 'al día',
  'status.freshness.STALE': 'ha cambiado desde que se calculó',
  'status.freshness.UNRESOLVABLE': 'ya no se puede comprobar',

  'status.run.PENDING': 'en cola',
  'status.run.RUNNING': 'en curso',
  'status.run.SUCCESS': 'correcto',
  'status.run.FAILED': 'con errores',
  'status.run.PARTIAL': 'parcial',
  'status.run.CANCELLED': 'cancelado',

  'status.connection.PENDING': 'sin sincronizar',
  'status.connection.CONNECTED': 'conectada',
  'status.connection.SYNCING': 'sincronizando',
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
  'dashboard.steps.sync.action': 'Sincroniza para que aprenda',
  'dashboard.steps.sync.why':
    'Hasta que no entre nada, BusinessBrain no sabe nada de tu empresa.',
  'dashboard.steps.ask.action': 'Hazle una pregunta',
  'dashboard.steps.ask.why':
    'Responderá con lo que sabe y te dirá de qué documentos lo ha sacado.',
  'dashboard.steps.analysis.action': 'Lanza un análisis',
  'dashboard.steps.analysis.why':
    'Busca por su cuenta riesgos, anomalías y oportunidades en lo que ya sabe.',

  // ── Comprensión ──────────────────────────────────────────────────────────
  'common.confidence': 'confianza {value}',
  'insights.title': 'Conclusiones ({count})',
  'insights.empty':
    'No hay conclusiones dentro de tu alcance. Puede que no haya análisis todavía, o que no tengas acceso a las colecciones que las sostienen.',
  'insight.badge.freshEvidence': 'evidencia intacta',
  'insight.badge.evidenceChanged': 'su evidencia cambió',
  'insight.badge.evidenceUnresolvable': 'evidencia irresoluble',
  'insight.badge.disputed': 'validación en disputa',
  'insight.badge.inherited': 'validado en una versión anterior',
  'insight.badge.curated': 'validado por una persona',

  // ── Análisis ─────────────────────────────────────────────────────────────
  'analysis.title': 'Análisis',
  'analysis.needsAdmin':
    'Lanzar y consultar análisis requiere permisos de administración en esta organización.',
  'analysis.run.title': 'Lanzar un análisis',
  'analysis.run.button': 'Analizar ahora',
  'analysis.run.busy': 'Analizando…',
  'analysis.run.explain':
    'El motor recorre el conocimiento indexado, deriva conclusiones y las reconcilia con lo que ya creía. Si una conclusión cambia, la anterior no se borra: queda como versión superada.',
  'analysis.result.summary':
    '{created} conclusión(es) nueva(s) · {known} ya conocida(s) · {candidates} candidato(s) evaluado(s).',
  'analysis.result.seeInsights': 'Ver comprensión',
  'analysis.result.proposals': '{count} recomendación(es) para revisar',
  'analysis.runs.title': 'Ejecuciones',
  'analysis.runs.empty': 'Todavía no se ha ejecutado ningún análisis.',
  'analysis.runs.column.status': 'Estado',
  'analysis.runs.column.origin': 'Origen',
  'analysis.runs.column.started': 'Inicio',
  'analysis.runs.column.finished': 'Fin',
  'analysis.trigger.automatic': 'automático',
  'analysis.trigger.manual': 'manual',

  // ── Objetivos ────────────────────────────────────────────────────────────
  'objectives.declare.title': 'Declarar un objetivo',
  'objectives.declare.why':
    'Sin un objetivo confirmado, el sistema puede decirte qué está pasando, pero no si eso es un riesgo o una oportunidad para tu empresa.',
  'objectives.field': 'Objetivo',
  'objectives.placeholder': 'El margen comercial no debe bajar del 30 %.',
  'objectives.declare': 'Declarar',
  'objectives.title': 'Objetivos ({count})',
  'objectives.empty': 'Ninguno declarado todavía.',
  'objectives.column.statement': 'Objetivo',
  'objectives.column.status': 'Estado',
  'objectives.column.origin': 'Origen',
  'objectives.column.declared': 'Declarado',
  'objectives.status.confirmed': 'confirmado',
  'objectives.status.inferred': 'propuesto por el sistema',
  'objectives.origin.person': 'una persona',
  'objectives.origin.inferred': 'inferido',
  'objectives.confirm': 'Confirmar',
  'objectives.discard': 'Descartar',

  // ── Preguntar ────────────────────────────────────────────────────────────
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
  'ask.indexedAt': 'indexado {date}',

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
  'recs.evidence.show': 'Ver evidencia',
  'recs.evidence.hide': 'Ocultar evidencia',
  'recs.evidence.why': '¿Por qué me propones esto?',
  'recs.evidence.from': 'Sale de esta conclusión:',
  'recs.evidence.openIt':
    '(confianza {confidence}) — ábrela para ver los documentos en los que se apoya.',
  'recs.evidence.gone': 'La conclusión que la originó ya no está disponible.',
  'recs.accept': 'Aceptar',
  'recs.dismiss': 'Descartar',
  'recs.readOnly': 'Solo lectura: pide a un compañero con permisos que decida.',

  // ── Detalle de una conclusión ────────────────────────────────────────────
  'insight.notFound': 'No encontrada.',
  'insight.title': 'Conclusión',
  'insight.curatedOwn': 'Validada sobre esta misma versión',
  'insight.curatedInherited':
    'Validada sobre una versión anterior de esta creencia',
  'insight.curatedOn': 'el {date}.',
  'insight.curationDisputed':
    'La evidencia posterior contradice lo que se validó.',
  'insight.mattersBecause': 'Importa porque:',
  'insight.evidence': 'Evidencia ({count})',
  'insight.decide.title': 'Tu decisión',
  'insight.decide.explain':
    'Lo que decidas tiene prioridad sobre cualquier recálculo automático posterior, hasta que lo revoques. Descartarla la retira de la lectura habitual, sin borrar nada.',
  'insight.decide.field': 'Decisión',
  'insight.decide.confirm': 'La confirmo',
  'insight.decide.correct': 'La corrijo',
  'insight.decide.dismiss': 'La descarto',
  'insight.decide.comment': 'Comentario (opcional)',
  'insight.decide.submit': 'Registrar',
  'insight.decide.done': 'Decisión registrada.',
  'insight.history.title': 'Cómo ha cambiado esta creencia',
  'insight.history.empty':
    'No hay ninguna versión visible dentro de tu alcance.',
  'insight.history.current': 'versión actual',
  'insight.history.superseded': 'superada',
  'insight.history.evidenceCount': '{count} evidencia(s)',
  'insight.history.confidenceRose': 'La confianza subió {delta} porque:',
  'insight.history.confidenceFell': 'La confianza bajó {delta} porque:',
  'insight.history.outOfScope':
    'Y {count} cambio(s) más fuera de tu alcance, que no podemos detallarte.',
  'insight.history.hiddenVersions':
    'Hay {count} versión(es) de esta creencia que no puedes ver con tu alcance actual.',
  'insight.change.ENTERED': 'entró evidencia nueva',
  'insight.change.LEFT': 'dejó de sostenerla',
  'insight.change.CONTRADICTED': 'la contradijo',
  'insight.change.SUPERSEDED_EVIDENCE': 'su fuente fue reemplazada',

  // ── Informes ─────────────────────────────────────────────────────────────
  'reports.title': 'Informes ({count})',
  'reports.empty': 'Ninguno todavía.',
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
  'reports.new.submit': 'Crear informe',
  'reports.sections': '{count} sección(es)',
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
  'automations.title': 'Automatizaciones ({count})',
  'automations.empty':
    'Ninguna todavía. Crea una para que el sistema analice tu conocimiento por su cuenta.',
  'automations.new.title': 'Nueva automatización',
  'automations.new.name': 'Nombre',
  'automations.new.namePlaceholder': 'Barrido semanal',
  'automations.new.when': 'Cuándo',
  'automations.new.timezone': 'Zona horaria: {timezone}',
  'automations.new.whatItDoes': 'Qué hará',
  'automations.new.reread': 'Volver a leer',
  'automations.new.sourceLabel': 'Fuente a sincronizar',
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
  'automations.lastRun': 'última ejecución {date}',
  'automations.nextRun': 'próxima {date}',
  'automations.action.SYNC_KNOWLEDGE_SOURCE': 'volver a leer la fuente',
  'automations.action.RUN_ANALYSIS': 'analizar',
  'automations.action.GENERATE_REPORT': 'generar informe',

  // ── Conocimiento ─────────────────────────────────────────────────────────
  'knowledge.collections.title': 'Colecciones',
  'knowledge.collections.why':
    'Una colección delimita quién puede ver qué. Todo documento debe estar en alguna: lo que no pertenece a ninguna no lo ve nadie.',
  'knowledge.collections.empty': 'Ninguna todavía.',
  'knowledge.collections.new': 'Nueva colección',
  'knowledge.collections.placeholder': 'Ventas',

  'knowledge.drive.title': 'Google Drive',
  'knowledge.drive.connected': 'conectado',
  'knowledge.drive.folders': '{count} carpeta(s) sincronizándose',
  'knowledge.drive.permission':
    'BusinessBrain pedirá permiso de SOLO LECTURA sobre tu Drive. Nunca escribe ni modifica nada, y puedes retirarlo cuando quieras.',
  'knowledge.drive.connect': 'Conectar Google Drive',

  'knowledge.gmail.title': 'Gmail',
  'knowledge.gmail.active': 'activa',
  'knowledge.gmail.unknownAccount': 'cuenta no identificada',
  'knowledge.gmail.labels': '{count} etiqueta(s) sincronizándose',
  'knowledge.gmail.revoked': 'revocada',
  'knowledge.gmail.revokedExplain':
    'El acceso a {account} se retiró. Lo que ya se había leído sigue disponible; para volver a recibir correo nuevo, conéctala otra vez.',
  'knowledge.gmail.thatAccount': 'esa cuenta',
  'knowledge.gmail.permission':
    'BusinessBrain pedirá permiso de SOLO LECTURA sobre tu correo. Nunca envía ni modifica nada. Solo entrará la etiqueta que elijas, y el correo indexado irá a una colección de acceso restringido: conectar Gmail no lo hace visible a toda la organización.',
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

  'knowledge.source.lastSync': 'última sincronización {date}',
  'knowledge.source.stats': '{created} nuevo(s), {updated} actualizado(s)',
  'knowledge.source.statsFailed': ', {failed} con error',
  'knowledge.source.notRetrievable':
    '{count} sin indexar para búsqueda: vuelve a sincronizar',
  'knowledge.source.syncing': 'Sincronizando…',
  'knowledge.source.readPage': 'Leer la página',
  'knowledge.source.sync': 'Sincronizar',
  'knowledge.source.uploading': 'Subiendo…',
  'knowledge.source.upload': 'Subir documento',
  'knowledge.upload.failed':
    'No hemos podido subir este documento. Revísalo y vuelve a intentarlo.',
  'knowledge.upload.unreadable':
    'No hemos podido leer {file}. Revísalo y vuelve a intentarlo.',
  'knowledge.upload.indexed': '{file} indexado y listo para preguntar.',
  'knowledge.upload.duplicate': '{file} ya estaba: no se ha duplicado.',

  'knowledge.items.title': 'Documentos ({count})',
  'knowledge.items.empty': 'Aún no hay documentos indexados.',
  'knowledge.items.column.title': 'Título',
  'knowledge.items.column.area': 'Área',
  'knowledge.items.column.status': 'Estado',
  'knowledge.items.column.confidence': 'Confianza',
  'knowledge.items.column.indexed': 'Indexado',
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
  'settings.org.slug': 'Identificador',
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
    'Su texto completo, para poder responder con citas. Se guarda en la base de datos de BusinessBrain.',
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

  'audit.target.User': 'cuenta',
  'audit.target.Organization': 'empresa',

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
} as const;

/** Las claves que existen. Una pantalla que pida otra cosa no compila. */
export type TranslationKey = keyof typeof es;

/** Un catálogo completo. Los idiomas nuevos pueden entrar como `Partial<Catalog>`. */
export type Catalog = Record<TranslationKey, string>;
