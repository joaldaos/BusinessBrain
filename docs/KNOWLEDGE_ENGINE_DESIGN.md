# Knowledge Engine — Especificación técnica oficial

**Estado: 🧊 ARQUITECTURA CONGELADA (2026-07-22), con una revisión formal aplicada (2026-07-22 — ver "Revisión formal — Subfase 2.2").** Aprobado por el usuario como base del diseño; sometido después a una auditoría externa adversarial (ver "Auditoría externa previa a la congelación") que encontró y corrigió 12 defectos reales antes de esta congelación. Es la especificación oficial de la Fase 2. Cualquier cambio posterior a este estado debe tratarse como una revisión formal del documento (nueva ronda de aprobación), no como una edición silenciosa.
**Alcance:** Solo arquitectura y diseño de dominio. No contiene código, pseudocódigo, ni decisiones de framework (NestJS, Prisma, DTOs, Controllers, Services, Workers). Cualquier developer debe poder implementar el sistema a partir de este documento sin necesidad de contexto adicional.
**Relación con otros documentos:** Este documento reemplaza y profundiza el §6-7 (modelo de datos y pipeline del Knowledge Engine) de [`docs/BUSINESSBRAIN_MIGRATION_PLAN.md`](./BUSINESSBRAIN_MIGRATION_PLAN.md). El resto de ese documento (auth, organizaciones, agentes, roadmap general) sigue vigente. Donde este documento y aquel entren en conflicto en materia de Knowledge Engine, **este documento es la fuente de verdad**.

---

## Revisión arquitectónica previa

Antes de consolidar este diseño se cuestionó el esbozo previo (§6-7 del plan de migración) buscando debilidades. Se identificaron cinco y se corrigen aquí de forma explícita:

| # | Debilidad detectada en el esbozo previo | Corrección aplicada en este documento |
|---|---|---|
| 1 | El versionado usaba una relación 1:1 (`supersedesId`) entre documentos. No puede representar una fusión de varios documentos en uno, ni la división de uno en varios. | El versionado se modela como un **grafo de linaje** con relaciones tipadas (`UPDATES`, `SPLIT_FROM`, `MERGED_FROM`, `DUPLICATE_OF`, `RESTORED_FROM`), no como un puntero único. Ver §3.7 y §6. |
| 2 | Un único booleano `isCanonical` confundía "última versión de un documento" con "versión oficial entre fuentes contradictorias". | Se separan en dos conceptos: **versionado** (evolución temporal de un mismo documento) y **canonicalización** (resolución de conflicto entre documentos distintos que describen el mismo hecho), con una entidad propia, `Canonical Knowledge Entity`. Ver §3.10 y §10. |
| 3 | La deduplicación solo comparaba hash exacto de contenido. No detecta duplicados casi-idénticos ni duplicados entre fuentes distintas. | Estrategia de deduplicación en tres niveles (hash exacto → similitud estructural → similitud semántica), con manejo explícito de duplicados parciales. Ver §7. |
| 4 | El confidence score se calculaba una vez y quedaba fijo. | Se diseña como un valor vivo: nace con una fórmula multi-factor, envejece con una función de decaimiento temporal, y se recalcula ante eventos concretos (nueva corroboración, contradicción, curación humana). Ver §8. |
| 5 | La recuperación semántica se apoyaba solo en similitud coseno sobre pgvector, sin considerar el comportamiento real de un índice HNSW compartido entre miles de tenants (el filtro por organización es un post-filtro sobre el índice aproximado, no un pre-filtro exacto, lo que degrada recall a medida que crecen los tenants). | Se documenta el riesgo explícitamente (§16, §17) junto con la mitigación (particionado lógico del índice, umbral de migración a un vector store dedicado) en vez de asumir que "pgvector escala igual siempre". |

Estas cinco correcciones se explican con más detalle en las secciones referenciadas y se resumen de nuevo en §18 (Decisiones de arquitectura) junto con las alternativas descartadas.

---

## Auditoría externa previa a la congelación

Antes de congelar este documento como especificación oficial se realizó una segunda revisión, esta vez adversarial: buscando activamente contradicciones, sobre-ingeniería, problemas de escalabilidad y deuda técnica, en vez de justificar el diseño ya escrito. Se encontraron doce hallazgos reales. Los seis primeros son contradicciones o defectos de consistencia y se corrigen directamente en el cuerpo del documento (ediciones ya aplicadas en las secciones indicadas). Los seis restantes no requieren rediseño pero sí quedar reconocidos explícitamente como riesgo o decisión, para no convertirse en deuda técnica silenciosa.

| # | Categoría | Hallazgo | Resolución |
|---|---|---|---|
| 1 | Contradicción | "Documento movido" (§6) actualizaba el origen del `KnowledgeItem` en sitio, violando el principio de no sobrescribir y de trazabilidad al origen (§2). | Se separa procedencia inmutable (origen histórico, nunca cambia) de ubicación actual mutable (fuente/colección activa); mover solo cambia la segunda. Ver §3.5, §6. |
| 2 | Contradicción | El pipeline de Retrieval (§13) no tenía ningún paso que excluyera ítems `REEMPLAZADO`/`ELIMINADO` ni miembros no canónicos en conflicto, pese a que §5 y §10 prometían esa exclusión "por defecto". | Se añade un paso de filtro de estado/canonicidad, obligatorio y no configurable, antes del filtro de confianza. Ver §13. |
| 3 | Contradicción | §5 prometía exclusión por defecto de ítems con confianza decaída; §13 describía el filtro de confianza como puramente opcional — sin piso por defecto, la promesa era falsa. | Se define un piso de confianza mínimo de plataforma, activo por defecto (bajo, pero real); colecciones/agentes pueden endurecerlo, nunca desactivarlo del todo. Ver §8.5, §13. |
| 4 | Contradicción | §3.11 definía `Embedding` como propiedad exclusiva de un `KnowledgeChunk`; §7 hablaba de "compartir" el embedding entre chunks duplicados de ítems distintos — ambas afirmaciones no pueden ser ciertas a la vez. | Se aclara: lo que se reutiliza es el *cómputo* (cacheado por modelo + hash de contenido del chunk), no la propiedad del registro. Cada chunk conserva su propio `Embedding`; solo se evita la llamada al proveedor si el vector ya existe para ese hash. Ver §3.11, §7. |
| 5 | Consistencia de dominio | Dos mecanismos sin frontera definida para el mismo fenómeno (contenido casi idéntico): la arista `DUPLICADO_DE` del linaje (§6) y la agrupación en `Canonical Knowledge Entity` (§7 nivel 3). | Se delimita explícitamente: `DUPLICADO_DE` solo aplica a duplicados detectados dentro de la misma `KnowledgeSource`; todo duplicado detectado entre fuentes distintas pasa siempre por canonicalización y nunca genera esa arista. Ver §6, §7. |
| 6 | Consistencia de dominio | La clasificación es única por `KnowledgeItem` y se hereda igual en todos sus chunks (§3.6, §9); un documento largo y heterogéneo queda con una sola categoría para todos sus fragmentos, degradando el scoping de agentes por área. | Se añade una refinación condicional: cuando la certeza de clasificación a nivel de documento es baja (señal de contenido heterogéneo), la clasificación puede recalcularse a nivel de chunk en vez de heredarse sin más. Ver §3.6, §9. |
| 7 | Sobre-ingeniería / simplificación posible | La deduplicación semántica entre fuentes (§7 nivel 3) y la resolución de conflictos de canonicalización (§10) resuelven un problema — varias fuentes describiendo el mismo hecho — que no puede ocurrir todavía en la Fase 2, donde el roadmap (§19) solo contempla un conector de carga manual (una única fuente posible). | El modelo de dominio se mantiene (barato de definir ahora, evita migración futura), pero se pospone explícitamente la activación real de ambos mecanismos hasta que exista más de un tipo de conector (Fase 6). En Fase 2 quedan implementados como estructuralmente presentes pero no-operativos por construcción. Ver §19, §20. |
| 8 | Escalabilidad futura | El grafo de linaje es de solo-anexado; los ítems `REEMPLAZADO` no tienen ninguna política de archivado o purga de sus chunks/embeddings (a diferencia de los `ELIMINADO`, que sí tienen ventana de retención). Una fuente de alta frecuencia de cambio puede inflar el almacenamiento vectorial sin límite. | Se documenta como riesgo aceptado con mitigación futura (umbral de cambio mínimo para materializar una nueva versión; archivado de embeddings de versiones más allá de N generaciones). No se implementa en Fase 2. Ver §16, §17. |
| 9 | Escalabilidad futura / consistencia | El recálculo de confianza disparado por canonicalización (§8.4) no tenía cota de propagación: un cambio puede disparar reevaluación de un grupo, que cambia la confianza de otro miembro, que dispara otra reevaluación, sin límite de profundidad. | Se añade una regla explícita de propagación acotada: recómputo asíncrono, idempotente, con profundidad máxima configurable. Ver §8.4. |
| 10 | Deuda técnica | Los umbrales (similitud "alta", diferencia "por encima de un umbral" para canonicalización, curva de decaimiento de confianza) estaban descritos en prosa, sin exigir que fueran configuración versionada en vez de constantes de código. | Se exige explícitamente que todos estos umbrales sean configuración por organización con valores por defecto de plataforma, nunca constantes fijas. Ver §8.3, §10, §18. |
| 11 | Deuda técnica | La reindexación por cambio de modelo de embeddings se exigía atómica a nivel de organización (§12), sin plan de fallo parcial ni corte incremental — arriesgado para tenants grandes. | Se añade como requisito no funcional: corte incremental por colección y proceso de reindexación reanudable ante fallo parcial. Ver §12. |
| 12 | Contradicción con infraestructura ya existente | El diseño exige soporte multi-proveedor/multi-modelo de embeddings (§12), pero el esquema de base de datos ya migrado en la Fase 1 (`packages/database/prisma/schema.prisma`) fija la columna de embedding en una única dimensión (`vector(1536)`). Cambiar a un modelo de otra dimensionalidad no es una simple reindexación de datos: requiere una migración de esquema. | Se documenta esta restricción real y actual (no hipotética): mientras no se ejecute una migración de infraestructura explícita, el cambio de proveedor de embeddings queda acotado, en la práctica, a modelos que produzcan vectores de la misma dimensionalidad ya migrada. Ver §12, §17. |

---

## 1. Visión del Knowledge Engine

### 1.1 Objetivo

El Knowledge Engine es el sistema responsable de convertir información dispersa y heterogénea de una organización (documentos, correos, registros de CRM/ERP, páginas web, bases de datos externas) en **conocimiento estructurado, versionado, verificable y recuperable con precisión** por cualquier superficie de IA de BusinessBrain (chat, agentes, automatizaciones, informes, API).

No es un almacén de documentos ni un buscador. Es la capa que decide, para cada pieza de información: si ya existía, si cambió, si es duplicada, cuánto se puede confiar en ella, a qué categoría de negocio pertenece, y cuál es su versión oficial cuando varias fuentes se contradicen.

### 1.2 Responsabilidades

- Recibir contenido crudo desde conectores externos y normalizarlo a una representación de texto estructurado independiente del formato de origen.
- Detectar si ese contenido ya existe (deduplicación) y, si existía y cambió, versionarlo sin perder el historial.
- Clasificar el contenido según una taxonomía de negocio.
- Calcular y mantener vivo un score de confianza por cada pieza de conocimiento.
- Resolver conflictos entre fuentes que describen el mismo hecho (canonicalización).
- Fragmentar (chunking) y generar representaciones vectoriales (embeddings) del contenido.
- Exponer un único punto de recuperación semántica, con aislamiento estricto por organización, que cualquier superficie de IA pueda consumir sin conocer los detalles internos del pipeline.
- Mantener trazabilidad completa: para cualquier respuesta de IA debe poder reconstruirse de qué documento, qué versión y con qué nivel de confianza salió cada dato.

### 1.3 Problemas que resuelve

- **Fragmentación**: el conocimiento de una empresa vive en 10 sistemas distintos con formatos distintos; el Knowledge Engine da una vista unificada.
- **Desactualización silenciosa**: sin versionado explícito, una IA puede responder con un dato de hace dos años sin saber que fue reemplazado.
- **Contradicción entre fuentes**: dos sistemas pueden decir cosas distintas sobre el mismo cliente/producto/política; alguien tiene que decidir cuál prevalece, y de forma auditable.
- **Confianza ciega**: no todo el conocimiento ingerido merece el mismo peso (un borrador no es lo mismo que una política firmada); sin un score explícito, el LLM trata todo por igual.
- **Alucinación por falta de trazabilidad**: si no se sabe de dónde salió cada fragmento de contexto, no se puede citar la fuente ni auditar un error.
- **Fuga de datos entre clientes**: en un SaaS multi-tenant, un fallo de aislamiento en la capa de recuperación es catastrófico; debe ser estructuralmente imposible, no solo una buena práctica.

### 1.4 Qué queda fuera de su responsabilidad

- **No genera respuestas de lenguaje natural.** Eso es responsabilidad de la capa de proveedor LLM y de las superficies de consumo (chat, agentes). El Knowledge Engine entrega contexto, no respuestas.
- **No decide qué proveedor de IA se usa** para generar embeddings o para clasificar (usa una capacidad externa desacoplada, ver §12), solo orquesta cuándo y con qué invocarla.
- **No gestiona la autenticación de usuarios ni la pertenencia a una organización** (responsabilidad del dominio de identidad/organizaciones).
- **No gestiona la lógica de negocio de agentes** (memoria de agente, herramientas, guardrails): el Knowledge Engine solo entrega conocimiento acotado por colección; qué hace un agente con ese conocimiento es responsabilidad de la capa de agentes.
- **No implementa los conectores concretos a cada sistema externo** en el sentido de mantener la integración viva a largo plazo (rate limits, cambios de API de terceros): el Knowledge Engine define el contrato que un conector debe cumplir (§3.1) pero cada conector es una pieza de infraestructura independiente.
- **No es un sistema de gestión documental** (no ofrece edición colaborativa, control de acceso a nivel de carpeta al estilo Google Drive, comentarios, etc.). Solo ingiere, entiende y sirve conocimiento derivado de esos documentos.

---

## 2. Principios de diseño

**Source of Truth.** El Knowledge Engine es la única fuente de verdad sobre "qué sabe la organización" a efectos de IA. Ninguna superficie de consumo (chat, agente, automatización) mantiene su propia copia de conocimiento o su propio criterio de qué es correcto: todas preguntan al Knowledge Engine y reciben la misma respuesta ante la misma pregunta y el mismo alcance de permisos.

**Nunca sobrescribir información.** Ninguna operación de actualización destruye el estado anterior. Un documento que cambia no se edita en sitio: se crea una nueva versión y la anterior se marca como reemplazada, pero sigue existiendo y siendo consultable. Esto es innegociable porque es la base de la trazabilidad y de poder responder "¿qué sabíamos el mes pasado?".

**Todo debe ser versionable.** No solo el contenido de un documento: la clasificación, el score de confianza y la decisión de canonicalización también cambian con el tiempo y también dejan rastro de por qué cambiaron.

**Todo debe ser trazable.** Cualquier fragmento de conocimiento usado por una IA debe poder trazarse hasta: la fuente original, el job de ingesta que lo trajo, la versión específica, y el motivo por el que se consideró canónico o se le asignó tal confianza. Sin esto, no se puede auditar ni depurar un error de la IA.

**Multi-tenant por diseño.** No existe ninguna operación de lectura o escritura de conocimiento que no esté acotada por organización desde el primer día. El aislamiento no es una capa añadida después: es un requisito de cada entidad y de cada proceso descrito en este documento.

**Separación absoluta entre conocimiento e IA.** El Knowledge Engine no sabe qué proveedor de LLM se usará para responder, ni construye prompts, ni decide el tono de una respuesta. Solo entrega conocimiento estructurado, puntuado y citable. Esto permite cambiar de proveedor de IA, o de estrategia de generación de respuestas, sin tocar el motor de conocimiento.

**Bajo acoplamiento.** Los conectores no conocen el pipeline de clasificación; el pipeline de clasificación no conoce el mecanismo de embeddings; la recuperación no conoce quién la consume (chat, agente, automatización). Cada pieza se comunica con la siguiente a través de un contrato de datos estable, no de una dependencia directa de implementación.

**Alta escalabilidad.** El diseño debe seguir siendo correcto (no necesariamente igual de rápido, pero sí correcto) entre 100 documentos y 10 millones de fragmentos. Donde el rendimiento se degrade a escala, debe existir un camino de evolución documentado (§16), no un rediseño de emergencia.

**Confianza como ciudadano de primera clase.** El sistema asume que no toda la información ingerida es igual de fiable, y hace ese juicio explícito y visible en vez de tratar todo el conocimiento indexado como verdad absoluta.

**Idempotencia de la ingesta.** Volver a sincronizar la misma fuente sin cambios no debe duplicar conocimiento, no debe generar nuevas versiones espurias, y no debe recalcular embeddings innecesariamente (ver §7 y §12). Esta garantía se exige también **bajo concurrencia** (corrección de la Revisión formal — Subfase 2.2, hallazgo D): dos ingestas simultáneas del mismo contenido, para la misma organización, nunca deben poder crear dos `KnowledgeItem` distintos que se traten mutuamente como si fueran contenido nuevo. Es un requisito de correctitud del dominio, no una optimización — la estrategia concreta para garantizarlo es una decisión de implementación que debe presentarse y aprobarse antes de escribir el código correspondiente (§7, nivel 1).

**Toda decisión se evalúa por su aporte a la comprensión del negocio.** Principio arquitectónico permanente, no exclusivo del Knowledge Engine (añadido en la Revisión formal — Subfase 2.2): cualquier decisión de diseño o de implementación, en cualquier módulo de BusinessBrain, se justifica por su capacidad de mejorar lo que BusinessBrain entiende de la empresa — qué sabe, cuánto puede confiarse en ello, de dónde viene, si sigue vigente. Una solución técnicamente elegante, eficiente o interesante que no mejora esa comprensión no debe implementarse solo porque sea posible construirla. Este principio se aplica por encima de cualquier preferencia de implementación individual y debe usarse como criterio de corte ante cualquier propuesta de mejora futura (ver "Propuestas para Fase 3").

---

## 3. Modelo de dominio

Este modelo describe entidades conceptuales, no tablas. No se especifican tipos de columna, claves foráneas ni ORM: se describe responsabilidad, relaciones y ciclo de vida de cada concepto.

### 3.1 Connector

**Responsabilidad.** Un Connector es una *capacidad de integración*: sabe cómo hablar con un tipo de sistema externo (subida manual de archivos, Google Drive, Gmail, un CRM, un ERP, un sitio web, una base de datos externa) y cómo extraer de él contenido crudo y sus metadatos (título, autor, fecha de modificación, URL de origen). Un Connector es una pieza de infraestructura versionada e independiente de cualquier organización — es el "tipo de fuente", no la conexión concreta de un cliente.

**Relaciones.** Un Connector es usado por muchas `KnowledgeSource` (una por cada organización que lo configura). Un Connector no pertenece a ninguna organización.

**Ciclo de vida.** Se publica una versión de un Connector cuando se soporta un nuevo tipo de sistema. Se puede deprecar (dejar de aceptar nuevas `KnowledgeSource` que lo usen) sin afectar a las fuentes ya configuradas, que siguen funcionando hasta que se migran explícitamente a una versión nueva del conector.

### 3.2 KnowledgeSource

**Responsabilidad.** Es la instancia configurada, por una organización concreta, de un Connector: las credenciales, el alcance (qué carpeta de Drive, qué buzón, qué tablas de la base de datos), la programación de sincronización y el estado de conexión.

**Relaciones.** Pertenece a una única organización. Usa exactamente un Connector. Tiene muchos `IngestionJob` (uno por cada ejecución de sincronización) y produce muchos `KnowledgeItem`.

**Ciclo de vida.** `PENDIENTE` (configurada, aún no sincronizada) → `SINCRONIZANDO` → `CONECTADA` (con sincronizaciones exitosas) ⇄ `ERROR` (fallo recuperable, reintentable) → `DESHABILITADA` (desconectada explícitamente por un usuario; el conocimiento ya ingerido no se borra, solo deja de recibir actualizaciones — ver §5).

### 3.3 IngestionJob

**Responsabilidad.** Registra una única ejecución de sincronización de una `KnowledgeSource`: cuándo empezó, qué la disparó (manual, programada, por evento), cuántos ítems encontró, creó, actualizó, marcó como duplicado o falló, y cuándo terminó.

**Relaciones.** Pertenece a una `KnowledgeSource` y a una organización. Los `KnowledgeItem` que produce quedan asociados a él para trazabilidad ("este documento entró en la sincronización del 14 de marzo").

**Ciclo de vida.** `PENDIENTE` → `EN CURSO` → `ÉXITO` / `FALLIDO` (parcial o total; un fallo parcial registra qué ítems concretos fallaron sin descartar los que sí se procesaron). Un `IngestionJob` nunca se modifica una vez terminado: es un registro histórico inmutable, base de la auditoría de ingesta.

### 3.4 KnowledgeCollection

**Responsabilidad.** Agrupación lógica de `KnowledgeItem` con un propósito de negocio (por área, por proyecto, por cliente). Es el mecanismo principal de **acotación de alcance**: un agente o una automatización no consulta "todo el conocimiento de la organización", consulta una o varias colecciones.

**Relaciones.** Pertenece a una organización. Contiene muchos `KnowledgeItem`; un mismo `KnowledgeItem` puede pertenecer a más de una colección (p. ej. una política de vacaciones puede estar en la colección de RR. HH. y en la de Operaciones) — relación N:M, no N:1. Es referenciada por agentes, automatizaciones e informes como alcance de conocimiento permitido.

> **Nota de corrección (Revisión formal — Subfase 2.2, hallazgo A).** Este documento siempre especificó la relación como N:M. El esquema de base de datos migrado en la subfase 2.1 la implementó por error como N:1 (un `KnowledgeItem` solo podía pertenecer a una colección), contradiciendo esta sección. Se corrige mediante una migración de esquema previa a la implementación de la subfase 2.2, para no construir la herencia de colecciones del versionado (§6) sobre un modelo que ya se sabía incorrecto.

**Ciclo de vida.** Se crea y se renombra libremente. Al eliminarse, no elimina los `KnowledgeItem` que contiene (solo la agrupación); cualquier agente que dependiera de esa colección como único alcance queda sin conocimiento asignado y debe reconfigurarse explícitamente (fallo seguro: mejor sin contexto que con contexto equivocado).

### 3.5 KnowledgeItem

**Responsabilidad.** Es la unidad atómica de conocimiento ingerido: un documento, un correo, un registro de CRM, una página — ya normalizado a texto estructurado, en un momento dado de su vida. Es sobre esta entidad donde actúan clasificación, confianza, deduplicación y versionado.

**Relaciones.** Pertenece a una organización. Tiene dos referencias distintas y no intercambiables a `KnowledgeSource`/`KnowledgeCollection`, corrección introducida en la auditoría previa a la congelación (hallazgo #1): una **procedencia** (de qué fuente y en qué sincronización nació este ítem — inmutable, fijada para siempre en el momento de creación, incluso si el ítem cambia de ubicación después) y una **ubicación actual** (fuente/colecciones a las que pertenece hoy a efectos de gestión y alcance — mutable). Un `KnowledgeItem` creado manualmente sin conector tiene procedencia nula. Se fragmenta en muchos `KnowledgeChunk`. Participa en el grafo de linaje de versiones (§3.7) y, opcionalmente, en un `Canonical Knowledge Entity` (§3.10).

**Ciclo de vida.** `PENDIENTE` → `PROCESANDO` (normalización, clasificación, confianza, chunking, embeddings en curso) → `INDEXADO` (recuperable) ⇄ `REEMPLAZADO` (una versión más nueva lo sustituyó; sigue existiendo y es consultable en modo histórico, pero no participa en recuperación por defecto) → `FALLIDO` (error de procesamiento, no se indexa, queda visible para diagnóstico) → `ELIMINADO` (baja lógica, ver §5).

> **Regla arquitectónica de evolución del ciclo de vida** (Revisión formal — Subfase 2.2, cierre del hallazgo D). `REEMPLAZADO`, `FALLIDO` y `ELIMINADO` son, por definición, los únicos estados **terminales** de este ciclo de vida — un ítem en cualquiera de ellos ha dejado de representar la identidad viva de su contenido a efectos de deduplicación (§7). Todo estado nuevo que se añada en el futuro a este ciclo de vida debe clasificarse explícitamente, en el momento de añadirlo, como **activo** (se suma al flujo vivo, como `PENDIENTE`/`PROCESANDO`/`INDEXADO`) o **terminal** (se suma al conjunto cerrado de arriba). Esta clasificación no es opcional ni implícita: debe quedar reflejada (a) en esta sección del documento y (b) en el test automatizado que valida el índice parcial de idempotencia (§7, "Especificación de idempotencia bajo concurrencia"). Un estado añadido al enum sin pasar por esa clasificación debe hacer fallar ese test en CI — la ausencia de clasificación nunca debe resolverse por omisión ni en el código ni en el esquema.

### 3.6 KnowledgeChunk

**Responsabilidad.** Fragmento de contenido de un `KnowledgeItem`, de tamaño acotado, con su representación vectorial (`Embedding`) asociada. Es la unidad real sobre la que opera la recuperación semántica — nunca se recupera un `KnowledgeItem` completo directamente, siempre se recuperan sus chunks.

**Relaciones.** Pertenece a exactamente un `KnowledgeItem` y hereda su organización y su confianza. Su clasificación se hereda del ítem **por defecto**, con una excepción explícita (corrección de la auditoría previa a la congelación, hallazgo #6): cuando el proceso de clasificación (§9) reporta baja certeza a nivel de documento completo — señal típica de contenido heterogéneo, p. ej. un manual que cubre varias áreas de negocio a la vez — la clasificación se recalcula por chunk en vez de heredarse sin más, para que el alcance de un agente por área no incluya (ni excluya) fragmentos equivocados de un documento mixto. Tiene una posición ordinal dentro del documento y metadatos estructurales (p. ej. "aparece bajo el encabezado 'Política de reembolsos'").

**Ciclo de vida.** Se crea junto con el `KnowledgeItem` al indexarlo y se elimina en cascada si el ítem se reemplaza o se elimina. Puede re-generarse (mismo contenido, nuevo vector) sin tocar el `KnowledgeItem` si cambia el modelo de embeddings (§12) — esa es la única operación de "regenerar sin nueva versión de conocimiento", porque el contenido no cambió, solo su representación vectorial.

### 3.7 Version (linaje de conocimiento)

**Responsabilidad.** No es una entidad con existencia propia, sino un **grafo de relaciones tipadas entre `KnowledgeItem`**. Cada arista del grafo tiene un tipo (`ACTUALIZA`, `DIVIDIDO_DESDE`, `FUSIONADO_DESDE`, `DUPLICADO_DE`, `RESTAURADO_DESDE`) y conecta uno o más ítems origen con uno o más ítems destino. Esta es la corrección arquitectónica frente a un simple puntero "reemplaza a" (§Revisión arquitectónica, punto 1): permite representar que un documento se dividió en tres, o que tres informes trimestrales se fusionaron en un anual, sin forzar esas relaciones N:1 o 1:N en un campo que solo admite 1:1.

**Relaciones.** Cada arista referencia `KnowledgeItem`s existentes; no introduce una entidad nueva de almacenamiento pesado, es metadata de relación.

**Ciclo de vida.** Las aristas se crean en el momento del proceso de versionado (§6) y **nunca se borran ni se editan** — son el historial inmutable que hace posible reconstruir "cómo llegamos a este estado" en cualquier momento futuro.

### 3.8 Classification

**Responsabilidad.** Value object adjunto a un `KnowledgeItem` (y, tras canonicalización, también al `Canonical Knowledge Entity`) que contiene: una categoría dentro de una taxonomía jerárquica de negocio, un conjunto de etiquetas libres, y el área funcional a la que pertenece (ventas, marketing, soporte, operaciones, finanzas, RR. HH., general — reutilizando el concepto de área ya definido para agentes en el plan de migración).

**Relaciones.** Pertenece a un `KnowledgeItem`. Referencia nodos de una taxonomía compartida a nivel de organización (§9).

**Ciclo de vida.** Se asigna durante el procesamiento inicial y puede recalcularse si el contenido se re-analiza (p. ej. tras una mejora del modelo de clasificación) o corregirse manualmente por un usuario con permisos — una corrección manual queda marcada como tal y no se sobrescribe automáticamente por una reclasificación futura salvo confirmación explícita.

### 3.9 Confidence

**Responsabilidad.** Value object que representa cuánto se puede confiar en un `KnowledgeItem` (o en el `Canonical Knowledge Entity` que lo agrupa): un score numérico normalizado, los factores que lo componen, y la fecha del último cálculo. No es un campo simple: es el resultado vivo de una fórmula (§8).

**Relaciones.** Pertenece a un `KnowledgeItem`; se agrega también a nivel de `Canonical Knowledge Entity` como la confianza "oficial" de ese conocimiento tras resolver conflictos entre fuentes.

**Ciclo de vida.** Se calcula al indexar, se recalcula por decaimiento temporal (proceso periódico) y se recalcula por evento (corroboración de otra fuente, contradicción detectada, curación humana, la fuente original se desconecta). Ver §8.

### 3.10 Canonical Knowledge Entity ("Canonical Item")

**Responsabilidad.** Agrupa uno o más `KnowledgeItem` (de la misma o de distintas `KnowledgeSource`) que representan el mismo hecho o entidad de negocio, y determina cuál de ellos (o qué combinación) es la versión oficial a efectos de recuperación. Esta es la corrección arquitectónica frente a usar `isCanonical` como simple booleano sobre el ítem (§Revisión arquitectónica, punto 2): resolver "cuál es la última versión de este documento" (problema de §3.7/versionado) es un problema distinto de "cuál es la verdad cuando el CRM dice una cosa y el ERP dice otra" (problema de canonicalización).

**Relaciones.** Agrupa varios `KnowledgeItem` candidatos. Mantiene una referencia al ítem (o combinación) actualmente canónico y al historial de qué fue canónico antes y por qué cambió.

**Ciclo de vida.** Se crea quando la deduplicación semántica detecta que dos `KnowledgeItem` de fuentes distintas describen el mismo hecho (§7, §10). Se actualiza cada vez que aparece un nuevo candidato o cambia la confianza de uno existente. No se elimina mientras exista al menos un `KnowledgeItem` miembro activo.

### 3.11 Embedding

**Responsabilidad.** Representación vectorial de un `KnowledgeChunk`, producida por un modelo de embeddings concreto. Incluye el identificador del modelo/versión que lo generó — esto es obligatorio, no opcional, porque vectores de modelos distintos no son comparables entre sí (§12).

**Relaciones.** Pertenece a exactamente un `KnowledgeChunk` — cada chunk tiene su propio registro de `Embedding`, sin excepción; no existe un `Embedding` compartido entre chunks de distintos ítems (corrección de la auditoría previa a la congelación, hallazgo #4: lo que puede reutilizarse entre chunks con contenido idéntico es el *cómputo* del vector — ver §7, "duplicados parciales" —, nunca la propiedad del registro). Un chunk puede tener, transitoriamente, más de un `Embedding` durante una migración de modelo (el antiguo y el nuevo conviven hasta que se completa la reindexación).

**Ciclo de vida.** Se genera al crear el chunk y se regenera completa (nunca se "actualiza parcialmente") cuando cambia el modelo de embeddings de la organización.

### 3.12 Contenido canónico

**Responsabilidad** (contrato arquitectónico añadido en la auditoría de implementación de la Subfase 2.2, tras encontrar y cerrar un defecto real). Es la única representación de un `KnowledgeItem` que cualquier mecanismo de deduplicación o de identidad de contenido —presente o futuro— puede usar para decidir si dos contenidos son "el mismo texto". No es una entidad ni un campo persistido propio: es una función pura, determinista, recalculable en cualquier momento a partir de `contentText`. Existe exactamente **una** función de canonicalización en todo el sistema; ningún mecanismo define su propia noción independiente de equivalencia.

**Por qué existe.** El nivel 1 (hash exacto, §7) y el nivel 2 (similitud estructural, §7) evaluaban "¿es el mismo contenido?" con dos criterios de normalización distintos entre sí — el hash trataba el espacio en blanco como significativo, la huella de similitud lo ignoraba por completo. Esa asimetría producía "versiones falsas": una reingesta que solo cambiaba de formato (espacios, tabuladores, saltos de línea, mayúsculas) no la detectaba el nivel 1, llegaba al nivel 2, y ahí se malinterpretaba como "contenido cambiado", generando una versión nueva espuria. La corrección no es un parche sobre espacios y saltos de línea: es que nivel 1 y nivel 2 —y cualquier mecanismo de identidad de contenido que se añada después— comparten obligatoriamente la misma noción de equivalencia.

**Transformaciones consideradas equivalentes** (no cambian el significado del documento):
- Normalización de saltos de línea (CR, CRLF → LF).
- Colapso de cualquier secuencia de espacios, tabuladores y saltos de línea a un único espacio.
- Recorte de espacio en blanco al principio y al final del documento completo.
- Normalización Unicode a forma canónica de composición (NFC) — mismo carácter, misma codificación, sin importar cómo llegó codificado.
- Eliminación de caracteres invisibles de formato (espacio de ancho cero, BOM, marcadores de unión/no-unión de ancho cero) — artefactos de copiar/pegar entre editores, sin carácter visible ni significado.
- Plegado de mayúsculas/minúsculas — la identidad del conocimiento no depende de la capitalización.

**Qué no se toca nunca**, para no alterar el significado del documento: palabras, números, puntuación, símbolos, tildes y caracteres acentuados como tales (solo se normaliza su codificación Unicode, nunca se eliminan ni se sustituyen por su equivalente sin acento), y el orden de palabras o frases. No hay lematización, no hay sinónimos, no hay eliminación de palabras vacías — canonicalizar es una operación de formato, nunca de interpretación semántica.

**Relaciones.** `contentText` (el texto almacenado, legible, el que se cita y se usará para chunking consciente de estructura, §11) nunca se sustituye por su forma canónica — la canonicalización es un paso derivado, calculado únicamente para comparar identidad, no para decidir qué se guarda ni qué se le muestra al usuario. `contentHash` (§3.5) se define como el hash del contenido canónico, nunca del texto crudo.

**Ciclo de vida.** No tiene uno propio — se deriva de `contentText` en cada cálculo, nunca se persiste ni se versiona por separado. Cuando la propia función de canonicalización cambia (una corrección, una ampliación), el `contentHash` ya almacenado de todo `KnowledgeItem` existente deja de ser comparable con el que produciría el código actual — exige una migración de datos (recálculo de `contentHash` para todos los ítems existentes, cualquier estado, no solo los activos), nunca una migración de esquema. Un recálculo que revele que dos `KnowledgeItem` activos coinciden en contenido canónico donde antes no coincidían no se resuelve automáticamente — se registra para revisión humana, coherente con que BusinessBrain nunca modifica conocimiento por su cuenta sin aprobación explícita.

---

## 4. Flujo completo del conocimiento

```
 Connector (capacidad de integración)
      │  configurado como →
      ▼
 KnowledgeSource (instancia por organización)
      │  dispara →
      ▼
 IngestionJob (una ejecución de sincronización)
      │  extrae contenido crudo →
      ▼
 Normalización  (PDF/HTML/CSV/registro CRM/email → texto estructurado)
      │
      ▼
 KnowledgeItem candidato (contenido normalizado, aún sin decidir su destino)
      │
      ▼
 Deduplicación  (§7: hash exacto → similitud estructural → similitud semántica)
      │
      ├── duplicado exacto de algo ya indexado ──► se descarta, se registra en el IngestionJob, FIN
      │
      ├── mismo documento lógico, contenido cambiado ──► Versionado (§6: nueva versión,
      │                                                    la anterior pasa a REEMPLAZADO)
      │
      └── contenido nuevo, sin relación previa ──► continúa como KnowledgeItem nuevo
      │
      ▼
 Clasificación  (§9: categoría + etiquetas + área de negocio)
      │
      ▼
 Confidence Score  (§8: cálculo inicial multi-factor)
      │
      ▼
 Canonicalización  (§10: ¿este hecho ya lo describe otra fuente? si sí, se agrupa en un
      │              Canonical Knowledge Entity y se resuelve cuál prevalece)
      │
      ▼
 Chunking  (§11: fragmentación consciente de estructura)
      │
      ▼
 Embeddings  (§12: vector por chunk, con modelo/versión registrados)
      │
      ▼
 Indexación  (el KnowledgeItem pasa a estado INDEXADO; sus chunks quedan recuperables)
      │
      ▼
 Retriever  (§13: única puerta de entrada a la recuperación semántica — filtra por
      │       organización, colección, confianza mínima; combina similitud vectorial
      │       y léxica; re-rankea; controla diversidad)
      │
      ▼
 Context Builder  (§14: ensambla el contexto dentro del presupuesto de tokens,
      │              ordena por relevancia, adjunta metadatos de cita)
      │
      ▼
 LLM  (consume el contexto para responder; no accede a KnowledgeChunk directamente
        bajo ninguna circunstancia)
```

**Explicación de cada paso:**

1. **Connector → KnowledgeSource**: una organización configura una fuente (p. ej. "nuestro Google Drive de RR. HH.") a partir de un conector existente.
2. **IngestionJob**: cada sincronización (manual o programada) es una ejecución propia y auditable, no un simple cambio de estado en la fuente.
3. **Normalización**: independientemente del formato de origen, el contenido se convierte a una representación de texto estructurado común, preservando jerarquía (títulos, secciones, tablas) cuando existe, porque esa estructura es insumo directo del chunking (§11).
4. **Deduplicación**: decide, antes que cualquier otra cosa, si vale la pena seguir procesando este contenido o si ya se conoce. Esta decisión también alimenta al proceso de versionado cuando el contenido es "casi el mismo documento, pero cambiado" (§6, §7).
5. **Clasificación y Confidence Score**: se calculan sobre contenido ya deduplicado, para no gastar cómputo clasificando duplicados que se van a descartar.
6. **Canonicalización**: ocurre después de tener clasificación y confianza porque ambas son insumo directo de "qué fuente prevalece" (§10).
7. **Chunking y Embeddings**: se ejecutan sobre el contenido ya resuelto (versión correcta, no duplicado, con confianza y clasificación asignadas), para no fragmentar ni vectorizar contenido que luego se descarta.
8. **Retriever**: es el único componente autorizado a ejecutar una búsqueda semántica sobre `KnowledgeChunk`. Ninguna superficie de consumo consulta el almacén vectorial directamente.
9. **Context Builder**: transforma una lista de chunks rankeados en un bloque de contexto listo para un prompt, con las citas necesarias para trazabilidad — pero sin construir el prompt final (eso incluye el system prompt del agente, el historial de conversación, etc., que son responsabilidad de la superficie de consumo).
10. **LLM**: consumidor final, ciego a cómo se produjo el contexto.

> Nota de diseño: el orden mostrado (Versionado antes que Deduplicación, tal como se pidió en el encargo) es el orden de *decisión*, no de *cómputo aislado*: en la práctica, deduplicación y versionado se resuelven como una sola decisión con tres salidas posibles (duplicado exacto / nueva versión / contenido nuevo), descrita como tal en §6 y §7 para evitar la falsa impresión de que son dos pasos secuenciales independientes.

---

## 5. Ciclo de vida

**Cómo nace un dato.** Un `KnowledgeItem` nace siempre a través de un `IngestionJob` (o, para contenido cargado manualmente, un job de tipo "carga directa" equivalente). No existe una vía de creación de conocimiento que no quede asociada a un job y, por tanto, a un origen trazable.

**Cómo cambia.** Un `KnowledgeItem` en sí mismo nunca cambia su contenido tras ser indexado. Un "cambio" observado en la fuente original siempre resulta en un `KnowledgeItem` nuevo, relacionado con el anterior mediante una arista `ACTUALIZA` en el grafo de linaje (§3.7). Sí pueden cambiar, sobre el mismo ítem, sin crear una versión nueva: su clasificación (si se re-analiza), su confidence score (por decaimiento o recorroboración) y su pertenencia a colecciones.

**Cómo se versiona.** Ver §6 en detalle.

**Cómo se vuelve obsoleto.** Un `KnowledgeItem` se considera obsoleto cuando: (a) fue reemplazado por una versión más nueva (`REEMPLAZADO`), o (b) su confidence score decayó por debajo de un umbral mínimo configurable sin haber sido recorroborado (queda `INDEXADO` pero se excluye de recuperación por defecto, no se borra). En ambos casos sigue existiendo para auditoría e historial.

**Cómo se elimina.** La eliminación es siempre lógica primero: el ítem pasa a `ELIMINADO`, deja de ser recuperable inmediatamente, pero conserva sus datos y su historial de linaje por un periodo de retención configurable por organización (por defecto, alineado con cualquier requisito de cumplimiento aplicable). La eliminación física (borrado real de contenido y vectores) es una operación administrativa separada y explícita — nunca ocurre como efecto secundario automático de otra operación, y su ejecución debe quedar auditada (quién, cuándo, por qué).

**Cómo se reindexa.** La reindexación (regenerar chunks y/o embeddings sin crear una nueva versión de conocimiento) ocurre cuando: cambia la estrategia de chunking, cambia el modelo de embeddings (§12), o se detecta corrupción/pérdida de los vectores. Es una operación sobre la *representación*, no sobre el *contenido* — por eso no genera una arista de versionado.

**Cómo se recupera.** Un `KnowledgeItem` en estado `ELIMINADO` dentro de su ventana de retención puede restaurarse explícitamente, lo que genera una arista `RESTAURADO_DESDE` en el grafo de linaje y lo devuelve a `INDEXADO` (con sus chunks y embeddings regenerados si fueron purgados). Pasada la ventana de retención, solo es recuperable desde una copia de seguridad de infraestructura, fuera del alcance del Knowledge Engine.

---

## 6. Versionado

El versionado resuelve un único problema: **el mismo documento lógico existió en más de un estado a lo largo del tiempo, y no queremos perder ninguno de esos estados.** Se modela como aristas tipadas del grafo de linaje (§3.7), nunca como sobrescritura.

| Escenario | Qué ocurre en el grafo de linaje | Estado resultante |
|---|---|---|
| **Documento nuevo** | No se crea arista; el `KnowledgeItem` nace sin predecesor. | `INDEXADO` |
| **Documento actualizado** | Arista `ACTUALIZA` desde el nuevo ítem hacia el anterior. | El anterior pasa a `REEMPLAZADO`; el nuevo queda `INDEXADO` y hereda la pertenencia a colecciones del anterior salvo indicación contraria. |
| **Documento eliminado** | No se crea arista de versionado (la eliminación no es una versión, es un cambio de estado — §5). | El ítem pasa a `ELIMINADO`. |
| **Documento restaurado** | Arista `RESTAURADO_DESDE` desde el ítem restaurado hacia su estado eliminado previo. | Vuelve a `INDEXADO`. |
| **Documento dividido** (un documento pasa a ser varios) | Aristas `DIVIDIDO_DESDE`: cada nuevo ítem apunta al ítem origen. El ítem origen pasa a `REEMPLAZADO` una vez todos sus fragmentos resultantes están indexados. | Varios `KnowledgeItem` nuevos, todos trazables al mismo origen. |
| **Documento fusionado** (varios documentos pasan a ser uno) | Aristas `FUSIONADO_DESDE`: el nuevo ítem apunta a cada uno de los orígenes. Todos los orígenes pasan a `REEMPLAZADO`. | Un `KnowledgeItem` nuevo con varios predecesores declarados. |
| **Documento duplicado** (se detecta como copia de otro tras la ingesta, no en el momento de ingerir) | Arista `DUPLICADO_DE` hacia el ítem que se conserva como principal — **solo cuando ambos pertenecen a la misma `KnowledgeSource`** (frontera fijada en la auditoría previa a la congelación, hallazgo #5: un duplicado detectado entre `KnowledgeSource` distintas nunca genera esta arista, siempre se trata como candidato de canonicalización, §7 nivel 3 y §10). | El duplicado no se marca `REEMPLAZADO` (no es una versión más nueva, es una copia); se marca con un estado de exclusión de recuperación propio para no contarlo dos veces, pero permanece consultable. |
| **Documento movido** (cambia de `KnowledgeSource` o de `KnowledgeCollection` actual, mismo contenido) | No genera arista de linaje (el contenido no cambió, solo su ubicación lógica actual). | Se actualiza únicamente la **ubicación actual** del ítem (§3.5); su **procedencia** original permanece intacta y consultable — mover nunca sobrescribe de dónde nació el ítem, solo dónde vive ahora (corrección de la auditoría previa a la congelación, hallazgo #1). Se dispara un evento de auditoría, no una nueva versión. |
| **Documento sustituido manualmente** (un usuario reemplaza el contenido "a mano", p. ej. corrige un error) | Arista `ACTUALIZA`, igual que una actualización automática, pero marcada con origen "manual" en vez de "sincronización". | Igual que actualización automática; la autoría queda registrada para diferenciar cambios humanos de cambios de conector. |

**Reglas transversales:** ninguna arista se borra nunca. Un `KnowledgeItem` puede tener como máximo un predecesor directo por tipo `ACTUALIZA` (una cadena lineal de versiones), pero puede tener múltiples predecesores bajo `DIVIDIDO_DESDE`/`FUSIONADO_DESDE` simultáneamente, lo cual es exactamente la limitación que un simple campo `supersedesId` no podía expresar.

---

## 7. Deduplicación

**Objetivo:** decidir, ante un contenido recién normalizado, si ya se conoce (y en qué grado), sin depender únicamente de una coincidencia exacta.

**Estrategia en tres niveles**, aplicados en orden creciente de coste computacional (se detiene en el primer nivel que da una resolución con confianza suficiente):

1. **Hash exacto de contenido.** Se calcula un hash sobre el **contenido canónico** (§3.12) del contenido ya normalizado (no sobre el binario original, para que dos formatos distintos del mismo texto —p. ej. un `.docx` y su exportación a `.pdf`— puedan coincidir; tampoco sobre diferencias de formato, mayúsculas o espacio en blanco, que la canonicalización ya hace equivalentes). Un hash idéntico dentro de la misma organización es un duplicado exacto: se descarta sin más procesamiento. Este nivel es barato y resuelve la mayoría de resincronizaciones sin cambios. La comprobación debe ser correcta bajo ingesta concurrente (§2, "Idempotencia de la ingesta"; Revisión formal — Subfase 2.2, hallazgo D): no basta con una lectura previa a la escritura si dos ingestas del mismo contenido pueden solaparse en el tiempo.

2. **Similitud estructural (casi-duplicados).** Para contenido con hash distinto pero candidato a ser "el mismo documento con cambios menores" (mismo título, mismo origen, tamaño similar), se compara mediante una huella de similitud de baja dimensionalidad (tipo shingling/minhash) que tolera pequeñas ediciones sin necesitar el coste de un embedding completo — calculada, igual que el nivel 1, sobre el **contenido canónico** (§3.12), nunca sobre el texto crudo. Un resultado por encima de un umbral alto de similitud estructural se trata como "misma línea documental, contenido cambiado" → dispara versionado (§6), no deduplicación pura.

3. **Similitud semántica (duplicados entre fuentes).** Para contenido sin relación estructural evidente pero que puede describir el mismo hecho de negocio desde una fuente distinta (el mismo dato de cliente en el CRM y en un correo, por ejemplo), se compara mediante similitud de embeddings a nivel de documento (no de chunk) contra los candidatos más próximos ya indexados. Un resultado por encima del umbral de similitud semántica no se descarta ni se versiona: se marca como candidato a **canonicalización** (§10), porque son dos piezas de conocimiento legítimamente distintas (fuentes distintas) que compiten por describir lo mismo.

**Duplicados parciales.** Cuando solo una porción del contenido coincide (p. ej. un documento incorpora un párrafo entero de una política ya existente, pero el resto es contenido nuevo), la deduplicación a nivel de documento no debe descartar el ítem completo. Este caso se resuelve a nivel de chunk: durante el chunking (§11), un fragmento individual que coincide en hash de contenido con un chunk ya existente evita **recomputar la llamada al proveedor de embeddings** para ese fragmento (se reutiliza el vector ya calculado como valor de partida). Esto no crea una entidad `Embedding` compartida entre chunks de ítems distintos — cada chunk conserva su propio registro, con su propia relación a su propio `KnowledgeItem` — solo se evita el coste de recalcular un vector idéntico (aclaración de la auditoría previa a la congelación, hallazgo #4; ver §3.11).

**Conflictos.** Cuando el nivel 3 detecta candidatos ambiguos (similitud alta pero no concluyente, o varios candidatos igualmente próximos), no se resuelve automáticamente: se agrupan como candidatos de un mismo `Canonical Knowledge Entity` pendiente de resolución, y la resolución de cuál prevalece se delega al proceso de canonicalización (§10), que sí tiene en cuenta confianza y recencia para decidir — la deduplicación solo *detecta* la posible coincidencia, no decide cuál gana.

**Frontera con el linaje de versiones (§6).** El nivel 3 (similitud semántica) opera exclusivamente **entre `KnowledgeSource` distintas**. Un candidato casi-idéntico detectado dentro de la misma fuente pertenece al nivel 2 (similitud estructural, dispara versionado) o, si se detecta retroactivamente sobre contenido ya indexado de la misma fuente, a la arista `DUPLICADO_DE` del linaje (§6) — nunca a canonicalización. Esta frontera, ausente en la versión anterior de este documento, se fija explícitamente en la auditoría previa a la congelación (hallazgo #5) para que deduplicación por versión y canonicalización entre fuentes no se solapen sobre el mismo caso.

**Especificación de idempotencia bajo concurrencia — niveles 1 y 2** (Revisión formal — Subfase 2.2, hallazgo D, cierre de la especificación). El nivel 1 (hash exacto) se garantiza mediante una restricción de unicidad a nivel de almacenamiento sobre (organización, hash de contenido). Esa restricción se define **por exclusión de los estados terminales** del ciclo de vida (§3.5) — `REEMPLAZADO`, `FALLIDO`, `ELIMINADO` — y no por inclusión de los estados activos. Es una decisión deliberada, no una preferencia estilística: el conjunto de estados terminales es cerrado y estable (son las únicas formas ya definidas en §3.5/§5 de dejar de representar conocimiento vivo), mientras que el conjunto de estados activos es el que crece con el tiempo a medida que el ciclo de vida se enriquece (p. ej. una futura clasificación de curación intermedia). Definir la restricción por exclusión hace que, ante un estado nuevo no clasificado todavía, el sistema falle en la dirección seguro (*fail-closed*): el estado nuevo queda protegido por defecto, en vez de quedar silenciosamente fuera del alcance de la deduplicación. Esta decisión es una regla arquitectónica formal, no solo un detalle de implementación — ver §3.5 para la obligación de clasificar cualquier estado nuevo y su exigencia de verificación automatizada en CI. Además, un intento fallido o un ítem eliminado nunca bloquean permanentemente una re-ingesta legítima del mismo contenido, precisamente porque quedan fuera de la restricción.

Toda escritura derivada de una decisión de deduplicación (creación del ítem, arista de linaje, cambio de estado del predecesor cuando aplica) se ejecuta como una única unidad atómica — se persiste por completo o no se persiste nada; no puede observarse nunca un `KnowledgeItem` a medio crear. Cuando dos ingestas concurrentes compiten por el mismo hash exacto, la restricción de unicidad resuelve el conflicto de forma determinista: una persiste como ítem original, la otra se reconoce como duplicado exacto sin que ello cuente como un fallo del `IngestionJob` que la contenía — el resultado es idéntico al de procesar ambas ingestas en cualquier orden secuencial. Cuando dos ingestas concurrentes compiten por actualizar el mismo documento predecesor (nivel 2), se serializan mediante un bloqueo a nivel de fila sobre ese predecesor, preservando la regla de §6 de que un `KnowledgeItem` tiene como máximo un predecesor directo por arista `ACTUALIZA`. Queda un caso residual, de severidad baja y aceptado por diseño: dos cargas nuevas, casi idénticas entre sí pero sin predecesor común todavía, que llegan exactamente en el mismo instante, pueden crear dos `KnowledgeItem` independientes en vez de uno solo enlazado por versionado — este caso ya está contemplado como escenario legítimo del propio modelo de dominio ("documento duplicado detectado retroactivamente", §6) y no requiere un mecanismo adicional en la subfase 2.2; se reevaluará si la tasa observada de este caso lo justifica.

**Nota de alcance para la Fase 2 (hallazgo #7 de la auditoría previa a la congelación; corregida en la Revisión formal — Subfase 2.2, hallazgo B).** La formulación original de esta nota razonaba por *tipo de conector* ("mientras el único conector sea la carga manual") para justificar que el nivel 3 no tiene candidatos reales en Fase 2. Eso era impreciso: la frontera del nivel 3, fijada arriba, es por **instancia de `KnowledgeSource`**, no por tipo de conector — una organización puede crear varias `KnowledgeSource` de tipo carga manual (p. ej. "Subidas RR. HH." y "Subidas Operaciones") y subir a ambas contenido que describa el mismo hecho, lo cual **sí** es un candidato legítimo de nivel 3 desde la propia Fase 2, sin esperar a la Fase 6.

Lo que sí es cierto, y es la razón real por la que el nivel 3 permanece desactivado en Fase 2, es que depende de dos capacidades que todavía no existen en el roadmap (§19) cuando se implementa la subfase 2.2: similitud de embeddings a nivel de documento (§3.11, §12 — subfase 2.6) y la entidad `Canonical Knowledge Entity` a la que agrupa sus candidatos (§3.10, §10 — subfase 2.5). Por tanto, en la subfase 2.2 el nivel 3 se implementa **únicamente como interfaz/puerto preparado** (firma y contrato de datos definidos, sin lógica de comparación real ni almacenamiento de candidatos) — no como una implementación funcional que "por construcción" no encuentra coincidencias. Se activa con lógica real cuando existan ambas dependencias, lo cual puede ocurrir ya en las subfases 2.5/2.6 si para entonces existen varias `KnowledgeSource` con contenido solapado, sin necesidad de esperar a conectores adicionales de la Fase 6.

---

## 8. Confidence Score

**Objetivo:** representar, con un número interpretable y explicable, cuánto puede confiar una IA en un `KnowledgeItem` dado. No es una etiqueta estática: es un valor que nace, cambia y envejece.

### 8.1 Cómo nace

Al indexar un `KnowledgeItem`, se calcula un score inicial combinando:

- **Confianza de la fuente**: cada `KnowledgeSource` tiene un nivel de confianza base según su tipo de conector (un documento subido manualmente y marcado como "política oficial" pesa distinto que un email capturado automáticamente).
- **Certeza de la clasificación**: cuán segura estuvo la clasificación (§9) al asignar categoría; una clasificación ambigua penaliza levemente la confianza global.
- **Completitud del contenido**: contenido truncado, mal extraído (p. ej. un PDF escaneado sin buen reconocimiento de texto) recibe una penalización.
- **Señal de autoridad explícita**: metadatos del propio documento o de la fuente que indiquen estatus oficial (p. ej. "firmado", "aprobado", "borrador").

### 8.2 Cómo cambia

- **Corroboración**: si otra fuente independiente aporta contenido que coincide o refuerza este `KnowledgeItem` (detectado en canonicalización, §10), su confianza sube.
- **Contradicción**: si otra fuente lo contradice y esa otra fuente tiene confianza igual o mayor, la confianza de este ítem baja (nunca se ignora la contradicción en silencio: siempre queda registrada como evento, aunque no cambie cuál es el canónico).
- **Curación humana**: un usuario con permisos puede fijar manualmente una confianza (marcar como "verificado" o "no confiable"); una fijación manual tiene prioridad sobre el recálculo automático hasta que se revoca explícitamente.
- **Desconexión de la fuente**: si la `KnowledgeSource` que originó el ítem se deshabilita o entra en error prolongado, la confianza no se anula pero se marca con una señal de "fuente inactiva", que el proceso de decaimiento tiene en cuenta con más severidad.

### 8.3 Cómo envejece (decaimiento)

Todo `KnowledgeItem` sin recorroboración ni recálculo pierde confianza de forma gradual con el tiempo, con una velocidad de decaimiento que depende de su clasificación (una política de RR. HH. envejece más lento que una nota de una reunión; esto se configura por categoría de la taxonomía, no de forma global). El decaimiento nunca lleva la confianza a cero automáticamente: existe un piso mínimo por debajo del cual el ítem se excluye de recuperación por defecto (§5, "obsolescencia"; el mecanismo de exclusión se detalla en §8.5) pero no se elimina.

> **Umbrales como configuración, no como constantes** (corrección de la auditoría previa a la congelación, hallazgo #10): la velocidad de decaimiento por categoría, el piso mínimo de confianza y cualquier otro umbral cualitativo mencionado en esta sección son valores de configuración por organización, con un valor por defecto de plataforma razonable — nunca constantes fijadas en el diseño o en el código. Esto es deliberado: no existen todavía datos reales de uso para calibrarlos de forma definitiva, y tratarlos como constantes los convertiría en deuda técnica silenciosa el día que haya que ajustarlos.

### 8.4 Cómo se recalcula

El recálculo no es continuo: se dispara por eventos concretos (nueva corroboración o contradicción detectada por canonicalización, curación humana, desconexión de fuente) y, además, por un barrido periódico que aplica el decaimiento temporal a todo el conocimiento indexado. Cada recálculo queda registrado con la fecha y el factor que lo disparó — la confianza es auditable, no solo el número actual sino su historia.

**Propagación acotada** (corrección de la auditoría previa a la congelación, hallazgo #9): un recálculo disparado por canonicalización (corroboración o contradicción entre miembros de un mismo `Canonical Knowledge Entity`) puede, en cascada, cambiar la confianza de otros miembros del mismo grupo, lo que en teoría podría re-disparar más recálculos indefinidamente. Esta propagación se ejecuta siempre de forma asíncrona, es idempotente (recalcular dos veces con la misma entrada da el mismo resultado, no acumula efecto) y tiene una profundidad máxima de propagación configurable — al alcanzarla, el ciclo se corta y el estado se deja para revisión, en vez de seguir propagando indefinidamente.

### 8.5 Cómo afecta al Retrieval

La confianza no actúa como un filtro binario arbitrario: actúa primero como un **piso mínimo de plataforma, activo por defecto** (corrección de la auditoría previa a la congelación, hallazgo #3 — sin este piso por defecto, la promesa de §5 de excluir por defecto el conocimiento obsoleto por decaimiento no se cumplía realmente), y en segundo lugar como **factor de ranking** en la recuperación (§13) para todo lo que sí supera ese piso: contenido de menor confianza puede seguir siendo recuperado si es muy relevante, pero rankeado por debajo de contenido igualmente relevante y más confiable. Por colección o por agente puede **endurecerse** ese piso (nunca relajarse por debajo del mínimo de plataforma) cuando el caso de uso lo exige (p. ej. un agente que responde sobre políticas legales puede exigir un piso más alto que el resto de la organización).

---

## 9. Clasificación

**Categorías y taxonomía.** La clasificación se apoya en una taxonomía jerárquica por organización (p. ej. `Recursos Humanos → Políticas → Vacaciones`), con un conjunto de categorías predefinidas de fábrica (alineadas a las áreas de negocio ya usadas por agentes: ventas, marketing, soporte, operaciones, finanzas, RR. HH., general) que cada organización puede extender con sus propias subcategorías, pero no reemplazar por completo — mantener una raíz común permite comparar/agrupar conocimiento entre organizaciones a nivel de producto (analítica interna, plantillas de agentes) sin depender de que cada tenant nombre las cosas igual.

**Etiquetas.** Además de la categoría jerárquica (única, un ítem pertenece a un solo nodo de la taxonomía como categoría principal), se admite un conjunto abierto de etiquetas libres, no jerárquicas, para matices que no justifican un nodo propio de taxonomía (p. ej. `confidencial`, `q1-2026`, `cliente-acme`).

**Relaciones y jerarquías.** Un nodo de taxonomía puede tener un padre (jerarquía) y el proceso de clasificación asigna siempre el nodo más específico posible; la pertenencia a un nodo implica pertenencia implícita a todos sus ancestros (un ítem clasificado en `RR. HH. → Políticas → Vacaciones` también es recuperable si un agente tiene alcance sobre `RR. HH.` a secas).

**Metadatos.** Junto con categoría y etiquetas, la clasificación registra: el área de negocio derivada (para compatibilidad con el alcance de agentes), el nivel de certeza del propio proceso de clasificación (usado como insumo del confidence score, §8.1) y si la clasificación fue automática o corregida manualmente.

**Asignación.** La clasificación inicial es automática (capacidad de comprensión de lenguaje natural sobre el contenido normalizado, contra la taxonomía de la organización). Un usuario con permisos puede corregirla manualmente; una corrección manual queda marcada como tal y un reprocesamiento automático futuro no la sobrescribe salvo confirmación explícita del usuario.

**Granularidad frente a documentos heterogéneos** (corrección de la auditoría previa a la congelación, hallazgo #6). Asignar una única categoría a nivel de `KnowledgeItem` funciona bien para documentos enfocados en un solo tema, pero es insuficiente para un documento largo que mezcla varias áreas de negocio (p. ej. un manual del empleado que cubre a la vez RR. HH., IT y Finanzas): heredar esa única categoría a los cientos de chunks del documento asignaría a fragmentos de Finanzas la etiqueta de RR. HH., o viceversa, degradando el alcance por área usado por los agentes (§3.4). El propio proceso de clasificación reporta, junto con la categoría elegida, un nivel de certeza; cuando esa certeza cae por debajo de un umbral (señal de contenido heterogéneo), la clasificación se recalcula a nivel de chunk en lugar de heredarse del ítem sin más — el chunk hereda la clasificación del ítem por defecto, y solo se aparta de ese valor por defecto cuando la heterogeneidad detectada lo justifica, evitando reclasificar chunk a chunk en el caso común de documentos homogéneos.

---

## 10. Canonicalización

**Objetivo:** cuando existen varios `KnowledgeItem` (de la misma o de distinta fuente) que describen el mismo hecho de negocio, decidir cuál es la versión oficial a efectos de recuperación, sin destruir las demás.

**Cómo se agrupan los candidatos.** La agrupación en un `Canonical Knowledge Entity` (§3.10) ocurre cuando la deduplicación semántica (§7, nivel 3) detecta similitud alta entre `KnowledgeItem`s de fuentes distintas, o cuando un usuario los vincula manualmente ("estos dos documentos hablan de lo mismo").

**Cómo se resuelve cuál prevalece.** Se ordenan los candidatos de un `Canonical Knowledge Entity` por una combinación de: confianza actual (§8), confianza base de la fuente que lo originó, y recencia (más reciente gana en igualdad de confianza). El resultado se clasifica en dos casos:

- **Ganador claro** (diferencia de score por encima de un umbral): se marca automáticamente como canónico; los demás quedan como miembros no canónicos del grupo, consultables pero excluidos de recuperación por defecto.
- **Empate o diferencia insuficiente**: no se resuelve automáticamente. El grupo queda marcado como "en conflicto" y se expone a revisión humana (un usuario con permisos decide o confirma cuál prevalece). Mientras esté en conflicto, la recuperación puede optar por devolver ambos candidatos con una señal explícita de "fuentes en desacuerdo", en vez de fingir certeza que no existe.

**Qué ocurre cuando aparece una fuente nueva.** Un nuevo candidato para un `Canonical Knowledge Entity` ya resuelto no reemplaza al canónico automáticamente: se evalúa contra el ganador actual con las mismas reglas (ganador claro vs. conflicto). Esto evita que una fuente de baja confianza recién conectada desplace conocimiento bien establecido solo por ser más reciente.

**Relación con el versionado.** La canonicalización nunca genera una arista de linaje de versión (§3.7): un documento no reemplaza a otro en el sentido de "es su continuación temporal", compite con él en el sentido de "describe lo mismo desde otro origen". Son ejes ortogonales y deliberadamente no se mezclan (ver Revisión arquitectónica, punto 2).

**Relación con la deduplicación.** El umbral que separa "ganador claro" de "conflicto" (arriba) y el umbral de similitud del nivel 3 de deduplicación (§7) son, igual que los umbrales de confianza (§8.3), configuración explícita por organización con valor por defecto de plataforma — nunca constantes de código (hallazgo #10 de la auditoría previa a la congelación). Como se detalla en §7 ("Nota de alcance para la Fase 2", corregida en la Revisión formal — Subfase 2.2, hallazgo B), este proceso puede tener candidatos reales ya en Fase 2 (varias `KnowledgeSource` con contenido solapado), pero no está operativo en la subfase 2.2 ni en la 2.5 sintética porque depende de embeddings a nivel de documento (subfase 2.6); su primera activación con lógica real ocurre cuando ambas dependencias (canonicalización y embeddings) existen simultáneamente.

---

## 11. Chunking

**Estrategia principal: consciente de estructura.** Cuando la normalización (§4) preserva jerarquía (encabezados, párrafos, tablas, listas), el chunking respeta esos límites: un fragmento no corta a mitad de una tabla ni a mitad de un párrafo si puede evitarlo, y cada chunk conserva metadata de su posición jerárquica (bajo qué encabezado aparece), que se reutiliza en la cita mostrada al usuario (§14).

**Estrategia de respaldo: tamaño fijo con solape.** Para contenido sin estructura reconocible (texto plano, transcripciones), se aplica fragmentación por tamaño objetivo con solape entre fragmentos consecutivos, para no perder contexto que quede exactamente en el límite de un corte.

**Tamaño y overlap.** El tamaño objetivo se define en un rango medio (ni tan pequeño que pierda contexto semántico dentro del propio fragmento, ni tan grande que diluya la precisión de la recuperación o encarezca innecesariamente el presupuesto de tokens en el momento de construir el contexto). El solape es una fracción menor del tamaño del chunk — suficiente para no perder una idea partida por un corte, sin duplicar excesivamente contenido entre fragmentos vecinos.

**Casos especiales.** Tablas grandes y bloques de código/datos estructurados se tratan como unidades atómicas cuando es posible (no se fragmentan a mitad de fila), aunque excedan el tamaño objetivo normal, porque fragmentarlos rompe su interpretabilidad.

**Coste.** Más fragmentación = más embeddings que generar y almacenar, más filas que indexar, pero recuperación más precisa (un chunk pequeño y específico rankea mejor para una pregunta puntual). Menos fragmentación = menos coste de indexación, pero cada chunk recuperado aporta más "ruido" (contenido irrelevante junto al relevante) al presupuesto de contexto.

**Ventajas del enfoque consciente de estructura** frente a tamaño fijo puro: mejor legibilidad de las citas mostradas al usuario, menor probabilidad de cortar una idea a la mitad, y metadata jerárquica reutilizable en el ranking (un fragmento bajo un encabezado que coincide con términos de la consulta puede rankear mejor).

**Inconvenientes**: mayor complejidad de implementación que el corte por tamaño fijo, y tamaños de chunk más variables (algunas secciones son mucho más largas que otras), lo que exige que el presupuesto de contexto (§14) razone en tokens reales por chunk, no en "número de chunks" como aproximación.

---

## 12. Embeddings

**Modelo.** El Knowledge Engine no fija un modelo de embeddings en el diseño de dominio: consume una capacidad externa de generación de embeddings (la misma abstracción de proveedor desacoplado ya usada para el LLM conversacional, ver `LlmModule` en el plan de migración) a través de un contrato estable. El modelo de embeddings puede coincidir o no con el proveedor conversacional (puede convenir usar un modelo especializado en recuperación aunque el chat use otro proveedor para generar texto).

**Proveedores.** Se admite más de un proveedor de embeddings, seleccionable por organización, con el mismo mecanismo de resolución que el LLM conversacional (perfil de organización, con posibilidad de clave propia del cliente).

**Versionado.** Cada `Embedding` registra qué modelo y qué versión de ese modelo lo generó (§3.11). Esto es obligatorio porque vectores producidos por modelos distintos no son comparables entre sí ni deben mezclarse en una misma búsqueda de similitud.

**Reindexación.** Cambiar el modelo de embeddings de una organización no reprocesa el conocimiento desde cero (no vuelve a normalizar, clasificar ni recalcular confianza): solo regenera los vectores de los chunks existentes. Durante la transición, conviven vectores del modelo antiguo y del nuevo; la búsqueda debe operar exclusivamente sobre vectores de un único modelo a la vez por organización (nunca mezclar similitudes calculadas con modelos distintos en un mismo ranking), lo que implica que la conmutación de qué modelo usa la recuperación es atómica a nivel de organización. Corrección de la auditoría previa a la congelación (hallazgo #11): el *proceso de reindexación en sí* — regenerar todos los vectores antes de esa conmutación — no se exige como una única operación monolítica; para tenants con gran volumen debe poder ejecutarse con corte incremental por colección y ser reanudable ante un fallo parcial, siempre que la conmutación final (activar el modelo nuevo para la búsqueda) solo ocurra cuando el 100% de los vectores de la organización estén regenerados.

**Restricción real de dimensionalidad** (hallazgo #12 de la auditoría previa a la congelación, no hipotético). La Fase 1, ya implementada y migrada, fija la columna de almacenamiento del embedding en una única dimensión vectorial. Esto significa que, hasta que se ejecute una migración de infraestructura explícita para soportar dimensiones variables (o una columna por dimensión soportada), el cambio de proveedor/modelo de embeddings está acotado en la práctica a modelos que produzcan vectores de esa misma dimensionalidad. Cambiar a un modelo de otra dimensionalidad no es una reindexación de datos: es un cambio de esquema de almacenamiento, con su propio proceso de migración, y debe tratarse y planificarse como tal, no confundirse con una reindexación ordinaria.

**Costes.** Generar embeddings tiene un coste por token igual que cualquier llamada a un proveedor de IA. Se controla mediante: deduplicación a nivel de chunk (§7, duplicados parciales) para no regenerar vectores de contenido ya vectorizado idéntico, procesamiento por lotes en vez de una llamada por chunk, y evitar reindexaciones completas salvo cuando el cambio de modelo lo justifica explícitamente (no se re-embebe "por si acaso").

---

## 13. Retrieval

**Objetivo:** dado un texto de consulta y un contexto de organización/alcance/permisos, devolver el conjunto de `KnowledgeChunk` más relevante, citable y confiable, en el orden correcto, sin fugas entre tenants.

**Pipeline, en orden:**

1. **Vectorización de la consulta**: la consulta se convierte a un vector con el mismo modelo de embeddings activo para esa organización (§12) — nunca se compara contra vectores de un modelo distinto.
2. **Recuperación híbrida de candidatos**: se combinan dos vías de recuperación en paralelo — similitud vectorial (semántica, tolera parafraseo) y coincidencia léxica/palabra clave (precisa para nombres propios, códigos, cifras exactas que la similitud semántica puede diluir). Depender solo de similitud vectorial pierde precisión exacta en estos casos; depender solo de léxico pierde capacidad de entender la intención.
3. **Filtro obligatorio de organización**: se aplica siempre, sin excepción, como primer filtro no negociable — ningún candidato de otra organización llega siquiera a evaluarse en los pasos siguientes (ver §15 sobre por qué este filtro se trata como estructural y no como un paso más).
4. **Filtro de estado y canonicidad** (obligatorio, no configurable — paso añadido en la auditoría previa a la congelación, hallazgo #2, que detectó que este filtro estaba prometido en §5 y §10 pero ausente del pipeline): se excluyen los chunks cuyo `KnowledgeItem` esté en estado `REEMPLAZADO` o `ELIMINADO`, y los que pertenezcan a un miembro no canónico de un `Canonical Knowledge Entity` resuelto. Un consumidor puede solicitar explícitamente "modo histórico" para saltarse este filtro (p. ej. una auditoría que necesita ver qué se sabía antes), pero nunca ocurre por omisión.
5. **Filtro de alcance y permisos**: acotación por `KnowledgeCollection` permitida para el consumidor (agente, automatización, usuario) y por cualquier restricción adicional de permisos que aplique.
6. **Filtro de confianza mínima**: aplica siempre el piso mínimo de plataforma activo por defecto (§8.5); por colección o por agente puede endurecerse este piso, nunca desactivarse (corrección del mismo hallazgo #3 ya descrito en §8.5, para que ambas secciones sean consistentes entre sí).
7. **Re-ranking**: los candidatos supervivientes se reordenan combinando similitud (vectorial + léxica), confianza actual, y recencia — ninguno de los tres domina por sí solo; el peso relativo es configurable por colección/agente según el caso de uso (un agente legal puede priorizar confianza sobre recencia; uno de soporte al cliente puede priorizar recencia).
8. **Control de diversidad**: se limita cuántos fragmentos del mismo `KnowledgeItem` pueden aparecer en un mismo resultado, para no monopolizar el contexto con un único documento aunque sea muy relevante, a costa de perder otras fuentes también útiles.
9. **Entrega**: se devuelve el conjunto final rankeado, cada uno con su referencia de cita (documento, versión, posición) lista para el Context Builder (§14).

---

## 14. Estrategia RAG

**Construcción del contexto.** El Context Builder recibe los chunks ya rankeados por el Retriever y los ensambla en un bloque de contexto, preservando el orden de relevancia (los más relevantes van primero, no al azar), y adjuntando a cada uno su referencia de cita.

**Límite de tokens.** El presupuesto de contexto es finito y compartido con el resto del prompt (system prompt del agente, historial de conversación). El Context Builder respeta un presupuesto máximo asignado específicamente al conocimiento recuperado; si el conjunto rankeado excede ese presupuesto, se descartan los chunks de menor rank completos — nunca se trunca un chunk a la mitad, porque un fragmento cortado a mitad de frase es peor que no incluirlo.

**Evitar alucinaciones.** El contexto entregado debe ir acompañado, a nivel de instrucción para la superficie de consumo (no de lógica propia del Knowledge Engine, que no construye prompts), de una directriz explícita: responder únicamente a partir del contexto entregado y declarar explícitamente cuándo la información no está disponible, en vez de completar con conocimiento general del modelo. El Knowledge Engine facilita esto marcando claramente, por cada chunk entregado, su nivel de confianza — de modo que la superficie de consumo pueda, por ejemplo, matizar una respuesta basada en contenido de baja confianza en vez de presentarla con la misma seguridad que una de alta confianza.

**Citar fuentes.** Cada chunk entregado lleva consigo la referencia necesaria para citar: documento de origen, versión específica, y posición dentro del documento. Esto permite que cualquier respuesta generada pueda mostrarse con "fuente: Política de Vacaciones v3, sección 2" en vez de una afirmación sin respaldo.

**Priorización de conocimiento.** Cuando compiten varias piezas de contexto relevantes, la prioridad la determina el ranking de recuperación (§13): relevancia semántica/léxica, confianza y recencia combinadas — el Context Builder no reordena por su cuenta, respeta el orden que ya llega del Retriever.

---

## 15. Seguridad

**Aislamiento entre organizaciones.** El filtro por organización en la recuperación (§13, paso 3) se trata como un requisito estructural, no como una condición de negocio más: toda ruta de acceso a `KnowledgeChunk` pasa obligatoriamente por el Retriever, y el Retriever nunca ejecuta una búsqueda sin ese filtro. No existe, por diseño, ningún camino alternativo de lectura directa del almacén vectorial que lo bypasee.

**Permisos.** Además del filtro de organización, el alcance de `KnowledgeCollection` actúa como segunda capa: un agente o automatización solo puede recuperar contenido de las colecciones a las que tiene acceso explícitamente concedido, nunca "toda la organización" por defecto.

**Auditoría.** Toda operación de recuperación queda registrada (quién/qué consumidor, con qué consulta, qué organización, qué resultados) para poder reconstruir después "por qué la IA dijo esto" o investigar un posible acceso indebido. Igualmente se audita toda operación de curación humana sobre confianza, clasificación o canonicalización, y toda eliminación física de conocimiento.

**Protección frente a fugas.** El contenido de conectores y cualquier credencial asociada nunca forma parte del contexto entregado a un LLM — solo el contenido normalizado del conocimiento en sí. El contenido ingerido se trata siempre como datos, nunca como instrucciones: ninguna superficie de consumo debe interpretar texto proveniente de un `KnowledgeChunk` como una instrucción de sistema (mitigación de inyección de prompt vía contenido ingerido, responsabilidad compartida con la capa de agentes que sí construye el prompt final).

---

## 16. Escalabilidad

| Volumen de documentos | Comportamiento esperado | Puntos de atención |
|---|---|---|
| **100** | Trivial en cualquier configuración. Recuperación instantánea, decaimiento de confianza y canonicalización operan sobre un volumen despreciable. | Ninguno relevante todavía. |
| **10.000** | Sigue siendo cómodo para un índice de similitud aproximada por organización. La deduplicación semántica (§7, nivel 3) empieza a tener un coste de comparación no trivial si se hace contra todo el histórico sin acotar candidatos. | Acotar la búsqueda de candidatos de deduplicación/canonicalización a un vecindario aproximado, no a comparación exhaustiva. |
| **100.000** | El filtro de organización sobre un índice aproximado compartido entre tenants empieza a mostrar el problema documentado en la Revisión arquitectónica (punto 5): si el índice no está particionado por tenant, el filtro de organización actúa como post-filtro sobre los vecinos aproximados devueltos por el índice, lo que puede degradar el recall para tenants pequeños dentro de un índice dominado por tenants grandes. | Empezar a particionar lógicamente el índice por organización (o por rangos de organizaciones) en vez de depender de un único índice global con post-filtro. |
| **1.000.000** | El barrido periódico de decaimiento de confianza (§8.3) y cualquier proceso que recorra "todo el conocimiento" deja de poder ejecutarse como un paso único; requiere procesamiento incremental por lotes. La reindexación completa por cambio de modelo de embeddings (§12) se vuelve una operación cara que debe planificarse, no ejecutarse bajo demanda inmediata. | Procesos de mantenimiento (decaimiento, reindexación) deben diseñarse como incrementales desde este volumen, no antes de necesitarlo. |
| **10.000.000** | El almacenamiento vectorial compartido en la misma base relacional que el resto del dominio transaccional empieza a competir por recursos con las cargas operativas normales (escrituras de conversaciones, agentes, etc.). Este es el umbral en el que la elección de infraestructura de §18 (pgvector sobre la misma base vs. vector store dedicado) debe revisitarse con datos reales de carga, no solo con la proyección de este documento. | Evaluar migrar la capa de recuperación vectorial a un almacén especializado, manteniendo el resto del modelo de dominio (versionado, confianza, canonicalización) sin cambios — el diseño de este documento es intencionalmente independiente de esa decisión de infraestructura. |

**Nota de diseño transversal:** ninguna de las entidades u operaciones descritas en este documento asume un volumen concreto. Los puntos de atención de la tabla son sobre la *infraestructura* que las soporta, no sobre el *modelo de dominio*, que se mantiene estable en todos los volúmenes.

---

## 17. Riesgos técnicos

| Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| Filtro de organización como post-filtro sobre un índice de similitud aproximada compartido, degradando recall a medida que crecen los tenants (Revisión arquitectónica, punto 5) | Alto — respuestas de menor calidad para tenants pequeños en una plataforma con tenants grandes | Media, se manifiesta a partir de ~100k documentos (§16) | Particionado lógico del índice por organización; monitoreo de recall por tenant; umbral documentado de migración a vector store dedicado |
| Inyección de prompt a través de contenido ingerido (un documento indexado contiene instrucciones dirigidas a la IA) | Alto — una IA podría ejecutar instrucciones no autorizadas o filtrar datos | Media | Contenido recuperado tratado siempre como dato, nunca como instrucción, a nivel de contrato con la capa de agentes (§15); herramientas con efectos requieren confirmación fuera del Knowledge Engine |
| Explosión de duplicados no exactos (variantes casi-idénticas) que un dedup por hash exacto no detecta, inflando volumen y confundiendo el ranking | Medio — ruido en recuperación, coste de almacenamiento innecesario | Media, si se dependiera solo del nivel 1 de deduplicación | Estrategia de deduplicación en tres niveles (§7); revisión periódica de tasa de duplicados detectados por nivel |
| Cambio de modelo de embeddings sin gestión atómica, mezclando vectores de modelos distintos en una misma búsqueda | Alto — resultados de similitud sin sentido (comparar vectores no comparables) | Baja si se sigue el diseño (§12), alta si se improvisa una migración ad hoc | Versionado obligatorio de modelo por `Embedding`; conmutación atómica por organización tras completar reindexación completa |
| Canonicalización automática incorrecta en casos ambiguos (elige un ganador cuando en realidad hay conflicto genuino) | Medio — la IA presenta como cierto un dato que en realidad está en disputa entre fuentes | Media | Umbral de "ganador claro" conservador; casos ambiguos van a revisión humana en vez de resolverse por defecto (§10) |
| Confianza estancada (nunca decae ni se recalcula por un fallo del proceso periódico) | Medio — conocimiento obsoleto tratado como igual de fiable que conocimiento fresco indefinidamente | Baja si el barrido periódico se monitorea | Alertar si el barrido de decaimiento no se ejecuta dentro de su ventana esperada; exponer fecha del último recálculo como dato visible, no oculto |
| Eliminación física accidental o prematura de conocimiento aún dentro de su ventana de retención | Alto — pérdida irreversible de trazabilidad/cumplimiento | Baja si se respeta la separación eliminación lógica/física (§5) | Eliminación física como operación administrativa separada y auditada, nunca automática ni implícita |
| Coste descontrolado de generación de embeddings por reindexaciones innecesarias o falta de deduplicación a nivel de chunk | Medio — impacto económico, no de correctitud | Media sin los controles de §12 | Deduplicación de chunks antes de vectorizar; procesamiento por lotes; reindexación solo ante cambio de modelo, nunca especulativa |
| Crecimiento no acotado del grafo de linaje y de embeddings de versiones `REEMPLAZADO` para fuentes de alta frecuencia de cambio (hallazgo #8 de la auditoría previa a la congelación) | Medio — coste de almacenamiento innecesario a largo plazo, no afecta correctitud | Media, se manifiesta con conectores de alta frecuencia de sincronización (p. ej. CRM sincronizado cada hora) | No implementada en Fase 2 (que solo tiene carga manual, de baja frecuencia); documentada como camino de evolución: umbral de cambio mínimo para materializar nueva versión, archivado de embeddings más allá de N generaciones |
| Cascada de recálculo de confianza sin cota de propagación entre miembros de un mismo `Canonical Knowledge Entity` (hallazgo #9 de la auditoría previa a la congelación) | Medio — coste de cómputo, riesgo de inconsistencia transitoria | Baja con la regla de profundidad máxima ya incorporada (§8.4), media si se implementa sin ella | Recómputo asíncrono, idempotente, con profundidad máxima configurable (§8.4) |
| Cambio de proveedor de embeddings a un modelo de dimensionalidad distinta a la ya fijada por el esquema migrado en Fase 1 (hallazgo #12 de la auditoría previa a la congelación) | Alto — intentarlo sin planificar la migración de esquema rompe la escritura/lectura de vectores | Baja mientras se respete la restricción documentada en §12; alta si se intenta un cambio de proveedor sin verificar antes la dimensionalidad | Tratar cualquier cambio a un modelo de dimensionalidad distinta como una migración de infraestructura explícita y planificada, nunca como una reindexación ordinaria (§12) |
| Condición de carrera en la detección de duplicado exacto (§7, nivel 1) bajo ingesta concurrente: dos sincronizaciones simultáneas del mismo contenido, para la misma organización, podrían crear dos `KnowledgeItem` que se tratan mutuamente como contenido nuevo (hallazgo D de la Revisión formal — Subfase 2.2) | Medio — duplicados silenciosos, viola la idempotencia exigida por §2 | Baja: cerrada mediante restricción de unicidad a nivel de almacenamiento + escritura atómica por candidato (§7, "Especificación de idempotencia bajo concurrencia") | Restricción de unicidad (organización, hash) definida **por exclusión** de los estados terminales (§3.5) — fail-closed ante estados futuros no clasificados todavía, ver regla arquitectónica de §3.5, exigida por test automatizado en CI; unidad atómica por candidato de ingesta; bloqueo a nivel de fila para actualizaciones concurrentes del mismo predecesor (nivel 2). Queda aceptado como riesgo residual de severidad baja el caso de dos cargas nuevas casi-idénticas sin predecesor común llegando en el mismo instante — ya cubierto por el escenario de dominio "documento duplicado detectado retroactivamente" (§6) |

---

## 18. Decisiones de arquitectura

| Decisión | Alternativa(s) descartada(s) | Motivo |
|---|---|---|
| Versionado como grafo de linaje con relaciones tipadas (§3.7, §6) | Puntero único "reemplaza a" (`supersedesId`) | No puede representar fusión ni división; forzarlo produciría modelos de datos incorrectos para esos escenarios, que el propio encargo exige soportar explícitamente |
| Canonicalización como entidad separada del versionado (§3.10, §10) | Un solo booleano "es canónico" sobre el ítem, combinando ambos problemas | Versionar (evolución temporal de un documento) y canonicalizar (elegir ganador entre fuentes contradictorias) son decisiones con insumos y consecuencias distintas; mezclarlas produce un modelo ambiguo cuando ambas ocurren a la vez sobre el mismo hecho |
| Deduplicación en tres niveles (hash → estructural → semántica) | Solo hash exacto | Un hash exacto no captura duplicados casi-idénticos ni duplicados entre fuentes distintas, que son casos reales y frecuentes en un entorno multi-fuente |
| Confidence score como valor recomputado con decaimiento y eventos (§8) | Score estático asignado una vez al indexar | Un score fijo no refleja que la confianza debe degradarse sin corroboración ni mejorar con evidencia adicional; sin esto, conocimiento viejo y nuevo se tratarían igual indefinidamente |
| Recuperación híbrida (vectorial + léxica) con re-ranking (§13) | Solo similitud vectorial | La similitud puramente semántica pierde precisión en nombres propios, códigos y cifras exactas; un híbrido cubre ambos casos sin renunciar a la comprensión de intención |
| Chunking consciente de estructura con respaldo de tamaño fijo (§11) | Solo tamaño fijo con solape | El tamaño fijo es más simple pero corta ideas a la mitad y pierde la jerarquía del documento, que es insumo valioso tanto para el ranking como para la calidad de la cita mostrada al usuario |
| Confianza mínima como filtro *opcional* configurable, no como umbral global fijo (§8.5, §13) | Umbral de confianza mínimo fijo para toda la plataforma | Casos de uso distintos (legal vs. soporte conversacional informal) toleran niveles de confianza distintos; un umbral único sería o demasiado laxo o demasiado restrictivo para alguno de los dos |
| Eliminación en dos fases (lógica primero, física como operación administrativa separada) (§5) | Eliminación física inmediata | Necesidad de ventana de recuperación y de trazabilidad/cumplimiento; una eliminación irreversible inmediata no permite corregir un error humano ni auditar qué se borró y por qué |
| Independencia explícita del modelo de dominio respecto a la infraestructura de almacenamiento vectorial concreta (§16, §18) | Diseñar el dominio asumiendo pgvector como definitivo para siempre | El volumen de un SaaS multi-tenant exitoso puede superar lo razonable para un índice compartido en la misma base relacional; el dominio (versionado, confianza, canonicalización, retrieval como contrato) debe sobrevivir a un eventual cambio de almacén vectorial sin rediseño |
| Modelar el nivel 3 de deduplicación semántica y la canonicalización completos desde ahora, pero implementar el nivel 3 solo como interfaz/puerto hasta que exista capacidad de embeddings a nivel de documento (§7, §10, §19) — decisión añadida en la auditoría previa a la congelación (hallazgo #7), corregida en la Revisión formal — Subfase 2.2 (hallazgo B/C) | Construir e implementar por completo ambos mecanismos ya en Fase 2 | El nivel 3 puede tener candidatos reales desde la propia Fase 2 (varias `KnowledgeSource` de carga manual con contenido solapado) — no es correcto, como se creyó inicialmente, que haga falta esperar a otro tipo de conector (Fase 6). Lo que sí impide una implementación funcional en 2.2/2.5 es la falta de embeddings a nivel de documento (subfase 2.6). Implementar la resolución automática de conflictos antes de tener esa capacidad sería coste sin beneficio verificable; modelar el dominio completo ahora y dar lógica real al nivel 3 en cuanto existan embeddings evita, a la vez, sobreingeniería prematura y una migración de dominio disruptiva más adelante |
| Todos los umbrales cualitativos (similitud de deduplicación, diferencia de "ganador claro" en canonicalización, curva de decaimiento de confianza, piso mínimo de confianza) son configuración por organización con valor por defecto de plataforma, nunca constantes de código (§8.3, §10) — decisión añadida en la auditoría previa a la congelación (hallazgo #10) | Fijar estos umbrales como constantes de la primera implementación, ajustándolos "cuando haga falta" | No existen todavía datos reales de uso para calibrarlos de forma definitiva; tratarlos como constantes los convierte en deuda técnica silenciosa el día que un caso de uso concreto exija un valor distinto |

---

## 19. Roadmap interno (Fase 2, dividida en subfases validables)

Cada subfase debe poder verificarse de forma completa e independiente antes de iniciar la siguiente. Ninguna subfase depende de trabajo de una subfase posterior.

1. **2.1 — Ingesta mínima**: un único conector (carga manual de archivos), `KnowledgeSource`, `IngestionJob` y normalización básica de texto. *Validación:* subir un archivo produce un `KnowledgeItem` normalizado, trazable a su job.
2. **2.2 — Deduplicación y versionado**: niveles 1 (hash exacto) y 2 (similitud estructural) de deduplicación (§7), con lógica real y correcta bajo concurrencia (§2, §7 nivel 1), y el grafo de linaje con sus escenarios (§6). El nivel 3 de deduplicación (§7) se implementa únicamente como interfaz/puerto preparado, sin lógica de comparación real — depende de embeddings a nivel de documento (subfase 2.6) y de `Canonical Knowledge Entity` (subfase 2.5), ninguna de las dos disponible todavía (Revisión formal — Subfase 2.2, hallazgo C). *Validación:* resubir el mismo archivo no duplica, incluida una resubida concurrente; subir una versión modificada crea una nueva versión enlazada; los escenarios de división/fusión pueden probarse manualmente; el puerto del nivel 3 existe y es invocable pero no produce candidatos.
3. **2.3 — Clasificación y confianza inicial**: taxonomía base, clasificación automática, cálculo inicial de confidence score (sin decaimiento todavía). *Validación:* todo `KnowledgeItem` indexado tiene categoría, etiquetas y un score inicial explicable (factores visibles).
4. **2.4 — Confianza viva**: decaimiento temporal, recálculo por eventos, curación manual. *Validación:* el score de un ítem sin actividad baja con el tiempo según lo esperado; una corrección manual persiste frente a un recálculo automático posterior.
5. **2.5 — Canonicalización**: agrupación en `Canonical Knowledge Entity`, resolución automática de ganador claro, cola de conflictos para revisión humana. El nivel 3 de deduplicación (§7) sigue sin lógica de comparación real en esta subfase porque los embeddings a nivel de documento no existen hasta la 2.6 (Revisión formal — Subfase 2.2, hallazgo B/C) — por tanto esta subfase construye el mecanismo completo de canonicalización, pero su alimentación automática desde el nivel 3 todavía no puede ejercitarse orgánicamente; **sí es posible ya en Fase 2** que existan varias `KnowledgeSource` de carga manual con contenido solapado, pero esa vía de entrada solo queda operativa cuando el nivel 3 se active con lógica real (subfase 2.6 en adelante), no antes. Su validación en esta subfase es necesariamente sintética (casos de prueba construidos a mano vinculando candidatos manualmente), no orgánica. La validación orgánica queda pendiente de cuando el nivel 3 esté activo, no necesariamente de la Fase 6. *Validación (Fase 2):* dos `KnowledgeItem` de prueba vinculados manualmente como candidatos se agrupan y se resuelven (o se marcan en conflicto) según las reglas de §10.
6. **2.6 — Chunking y embeddings**: fragmentación consciente de estructura, generación de embeddings versionados, deduplicación de chunks. *Validación:* un documento largo produce chunks coherentes con metadata de posición; regenerar embeddings no altera el contenido del `KnowledgeItem`.
7. **2.7 — Retrieval**: pipeline completo de recuperación (§13) como capacidad interna, sin ningún consumidor todavía conectado. *Validación:* una consulta de prueba devuelve chunks rankeados, filtrados por organización, con citas — verificable mediante pruebas de integración dedicadas a aislamiento entre tenants, antes de exponerlo a ninguna superficie de consumo.
8. **Puerta de salida de Fase 2**: solo cuando 2.1–2.7 están validadas de forma independiente se autoriza iniciar la Fase 3 (chat como primer consumidor del Retriever), tal como ya establece el roadmap general del plan de migración.

---

## 20. Qué NO hará todavía la Fase 2

Explícitamente fuera de alcance, para evitar ambigüedad sobre el límite de esta fase:

- **Ningún consumidor real del Retriever.** Chat, agentes, automatizaciones, informes y API pública se implementan en fases posteriores (3 en adelante); en Fase 2 el Retriever se valida de forma aislada.
- **Conectores más allá de carga manual de archivos.** Google Drive, Gmail, CRM, ERP, web scraping y bases de datos externas quedan definidos como Connectors conceptuales en este documento, pero su implementación real es de la Fase 6 (integraciones) del plan de migración general.
- **Marketplace o catálogo de plantillas de agentes.** No es responsabilidad del Knowledge Engine y no se toca en esta fase.
- **Hardening de aislamiento multi-tenant a nivel de infraestructura** (políticas de seguridad a nivel de base de datos como segunda capa de defensa, rate limiting, pruebas de carga): corresponde a la fase de hardening (Fase 9) del roadmap general; en Fase 2 el aislamiento se garantiza a nivel de diseño de dominio y se verifica con pruebas de integración, no con esa segunda capa de defensa todavía.
- **Particionado del índice vectorial por volumen** (§16, §18): se documenta como camino de evolución, no se implementa en Fase 2, que opera muy por debajo del umbral donde se vuelve necesario.
- **Aprendizaje automático de los pesos de ranking o de los factores de confianza.** Los pesos (similitud vs. confianza vs. recencia en el ranking; los factores del confidence score) se definen como configuración explícita y ajustable manualmente, no como un modelo que se entrena solo, en esta fase.
- **Fusión o división automática de documentos sin intervención humana.** Los escenarios de "documento dividido" y "documento fusionado" (§6) se modelan y se soportan como operación, pero su disparo en Fase 2 es manual/explícito, no una decisión automática del sistema.
- **Límites de uso por plan de suscripción** (cuotas de documentos indexados, tokens de embeddings por mes): corresponden a la Fase 7 (billing) del plan de migración general.
- **Resolución automática de conflictos de canonicalización con datos reales entre fuentes distintas** (añadido tras la auditoría previa a la congelación, hallazgo #7; corregido en la Revisión formal — Subfase 2.2, hallazgo B): el mecanismo se modela y se construye en Fase 2, pero el nivel 3 de deduplicación que lo alimenta (§7) solo tiene lógica de comparación real a partir de que exista capacidad de embeddings a nivel de documento (subfase 2.6 en adelante) — no a partir de que exista más de un tipo de conector (Fase 6), que era la formulación original de este punto. Un conflicto genuino puede darse ya en Fase 2 con varias `KnowledgeSource` de carga manual con contenido solapado, pero no se detecta automáticamente hasta que el nivel 3 esté activo. Su validación en Fase 2 (subfases 2.2-2.5) es sintética; su primera validación orgánica es responsabilidad de la primera subfase donde el nivel 3 tenga lógica real, no necesariamente de la Fase 6.
- **Archivado o purga de chunks/embeddings de versiones `REEMPLAZADO`** (hallazgo #8): se documenta como riesgo de escalabilidad futura (§16, §17), no se implementa ningún mecanismo de archivado en esta fase.
- **Migración de esquema para soportar dimensiones de embedding distintas a la ya fijada en Fase 1** (hallazgo #12): fuera de alcance; mientras no se ejecute esa migración explícita, el cambio de proveedor de embeddings queda acotado a modelos de la misma dimensionalidad (§12).
- **Interfaz de usuario.** Este documento y su implementación son de backend/dominio; cualquier pantalla para explorar conocimiento, revisar conflictos de canonicalización o ajustar confianza manualmente es responsabilidad de la Fase 8 (frontend) del plan general.

---

## Requisitos de calidad — checklist de cierre

- [x] No contiene código ni pseudocódigo.
- [x] No menciona NestJS, Prisma, DTOs, Controllers, Services ni Workers.
- [x] Cubre las 20 secciones solicitadas.
- [x] Incluye una revisión arquitectónica crítica previa, con alternativas descartadas justificadas.
- [x] Es consistente con las decisiones ya aprobadas en la Fase 1 (multi-tenancy por `organizationId`, proveedor de IA desacoplado, RBAC de organización) sin repetirlas innecesariamente.
- [x] Define explícitamente qué queda fuera de la Fase 2.
- [x] Superó una auditoría adversarial independiente (12 hallazgos: 6 contradicciones/consistencia corregidas en el cuerpo del documento, 6 riesgos/decisiones de escalabilidad y deuda técnica reconocidos explícitamente con mitigación).
- [x] No quedan contradicciones internas conocidas entre principios (§2), modelo de dominio (§3) y pipelines (§4, §13) tras la auditoría.

## Arquitectura Congelada

Este documento queda **congelado** como especificación oficial del Knowledge Engine para la Fase 2, en el estado resultante después de la auditoría externa previa a la congelación (tabla al inicio del documento). La congelación significa: cualquier developer puede empezar a implementar directamente contra este texto; ningún hallazgo pendiente de los doce identificados queda sin resolución (corrección en el cuerpo o riesgo/decisión documentada explícitamente); y cualquier cambio futuro al diseño aquí descrito requiere una revisión formal explícita, no una edición silenciosa del archivo.

**Regla de cambio durante la implementación** (fijada por el usuario al aprobar la congelación, 2026-07-22): ninguna decisión de dominio de este documento se modifica durante la implementación de la Fase 2, salvo que aparezca una contradicción demostrable con la realidad del código o un problema crítico imposible de resolver dentro del diseño aprobado. Cualquier mejora arquitectónica detectada durante la implementación que no cumpla ese criterio no se implementa: se registra en "Propuestas para Fase 3" (más abajo) y se continúa con el diseño aprobado tal como está.

**Próximo paso:** iniciar la implementación de la Fase 2 siguiendo el roadmap de §19, empezando por la subfase 2.1.

---

## Revisión formal — Subfase 2.2 (2026-07-22)

Antes de iniciar la implementación de la subfase 2.2, y con la subfase 2.1 ya cerrada, se realizó una revisión arquitectónica de esa subfase (rol de auditor técnico, no de implementador), siguiendo la regla de cambio fijada arriba: ningún hallazgo se implementó sin presentarse antes con ventajas, inconvenientes e impacto sobre el trabajo ya hecho, y sin aprobación explícita del usuario. Se encontraron cuatro hallazgos reales, los cuatro aprobados y resueltos según se detalla abajo. Se añade además un quinto punto: un principio arquitectónico nuevo, no derivado de un defecto sino propuesto proactivamente por el usuario al aprobar esta revisión.

| # | Categoría | Hallazgo | Resolución |
|---|---|---|---|
| A | Contradicción | El esquema de base de datos migrado en la subfase 2.1 implementó `KnowledgeItem` ↔ `KnowledgeCollection` como N:1, contradiciendo §3.4, que siempre especificó N:M. | Se corrige el esquema mediante migración, como prerrequisito de la subfase 2.2, antes de construir la herencia de colecciones del versionado (§6) sobre el modelo incorrecto. Ver §3.4. |
| B | Contradicción | §7 ("Nota de alcance para la Fase 2") y §10/§20 justificaban la desactivación del nivel 3 de deduplicación razonando por *tipo de conector* ("hasta que exista más de un tipo de KnowledgeSource"/"más de un conector"), mientras que la frontera real del nivel 3 (§7, "Frontera con el linaje de versiones") se define por *instancia* de `KnowledgeSource`. Con el único conector de Fase 2 (carga manual), una organización puede tener ya hoy varias `KnowledgeSource` con contenido solapado — un candidato de nivel 3 legítimo, no hipotético hasta la Fase 6. | Se corrige la justificación en §7, §10 y §20: el nivel 3 puede tener candidatos reales desde la propia Fase 2; lo que realmente lo mantiene inactivo es la falta de dos capacidades del roadmap (embeddings a nivel de documento, subfase 2.6; `Canonical Knowledge Entity`, subfase 2.5), no la ausencia de otro tipo de conector. |
| C | Simplificación de alcance | El nivel 3 de deduplicación (§7) depende de embeddings a nivel de documento (subfase 2.6), posterior a la subfase 2.2 en el roadmap (§19); no puede tener una implementación funcional real en 2.2 independientemente del hallazgo B. | En la subfase 2.2 se implementan con lógica real únicamente los niveles 1 y 2 de deduplicación (§7). El nivel 3 se construye solo como interfaz/puerto preparado (contrato de datos definido, sin lógica de comparación), activable con lógica real en la subfase donde converjan canonicalización (2.5) y embeddings (2.6). Ver §19, entradas 2.2 y 2.5. |
| D | Riesgo técnico no documentado — **cerrado** | El principio de idempotencia de la ingesta (§2) no contemplaba explícitamente concurrencia: nada en el documento impedía que dos ingestas simultáneas del mismo contenido, para la misma organización, pasaran ambas la comprobación de duplicado exacto (§7, nivel 1) antes de que la primera terminara de escribir, creando dos `KnowledgeItem` que se tratan mutuamente como contenido nuevo. | Se añade a §2 el requisito explícito de idempotencia bajo concurrencia. La especificación completa (restricción de unicidad a nivel de almacenamiento, unidad atómica por candidato, bloqueo de fila para actualizaciones concurrentes del mismo predecesor, y el riesgo residual aceptado) queda cerrada y documentada en §7, "Especificación de idempotencia bajo concurrencia — niveles 1 y 2", y reflejada en el registro de riesgos (§17). El documento fija el requisito y la estrategia a nivel de dominio/base de datos; los detalles de framework (ORM, manejo de errores de driver) son responsabilidad de la implementación de la subfase 2.2, sin quedar fijados aquí. |
| E | Principio nuevo (no ligado a un defecto) | — | Se añade a §2 el principio permanente "toda decisión se evalúa por su aporte a la comprensión del negocio": ninguna solución, por elegante que sea técnicamente, se implementa si no mejora lo que BusinessBrain entiende de la empresa. Aplica a todo el proyecto, no solo al Knowledge Engine. |

Ningún hallazgo de esta revisión contradice el modelo de dominio central (grafo de linaje tipado, deduplicación en tres niveles, canonicalización como entidad separada del versionado) — son correcciones de alcance de subfase, de una justificación textual imprecisa, y de un requisito no funcional ausente, no un rediseño.

---

## Auditoría de implementación — Subfase 2.2 (2026-07-23)

Con el bloque de deduplicación, linaje e idempotencia bajo concurrencia ya implementado y commiteado, se realizó una auditoría adversarial exclusivamente sobre la implementación (no sobre el diseño): demostrar, con pruebas reales contra la base de datos, que el código puede fallar — no solo releerlo. Se revisaron seis puntos:

| # | Punto auditado | Resultado |
|---|---|---|
| 1 | Dos `KnowledgeItem` activos con el mismo contenido | Sin defecto. Toda vía de creación pasa por la misma restricción de unicidad, sin importar qué rama del código la produjo; verificado con una carrera real de contenido idéntico. |
| 2 | Ciclos, doble predecesor o estados inconsistentes en el grafo de linaje | Sin defecto. Verificado con una carrera real (dos transacciones Postgres genuinas) de dos ediciones distintas compitiendo por el mismo predecesor: exactamente una arista `UPDATES`, sin doble supersesión. |
| 3 | Herencia de colecciones huérfana o duplicada | Sin defecto — la restricción de unicidad ya existente sobre `KnowledgeItemCollection` lo impide por construcción. |
| 4 | Concurrencia con varios workers/instancias | Sin defecto. Ninguna garantía depende de estado en memoria de proceso; todas viven en Postgres (índice único, bloqueo de fila), indistinguible entre una o varias instancias. |
| 5 | Versiones falsas por diferencias de formato/espacios/saltos de línea | **Defecto real, confirmado empíricamente**: nivel 1 y nivel 2 normalizaban el espacio en blanco de forma distinta entre sí, produciendo versiones espurias ante reingestas sin cambio de contenido real. Ver hallazgo F. |
| 6 | Excepción dejando la base de datos a medias | Sin defecto en el código de esta subfase — todas las escrituras de `resolveAndPersist` pasan por el mismo cliente transaccional. Se anota, sin contarlo como defecto de esta subfase por ser una característica ya heredada de la 2.1, el riesgo de que un `IngestionJob` quede en `RUNNING` si ambas actualizaciones finales de estado (fuera de cualquier transacción) fallasen de forma catastrófica. |

| # | Categoría | Hallazgo | Resolución |
|---|---|---|---|
| F | Contradicción real (defecto de implementación) | El nivel 1 (hash) trataba el espacio en blanco como significativo; el nivel 2 (shingling) lo ignoraba por completo al tokenizar. Esa asimetría entre "dos formas distintas de interpretar un documento" hacía que una reingesta sin ningún cambio de contenido, solo de formato, no la detectara el nivel 1 y el nivel 2 la malinterpretara como "contenido cambiado", generando una versión nueva espuria. | Se introduce el contrato arquitectónico de **contenido canónico** (§3.12): una única función de canonicalización, usada obligatoriamente por nivel 1 y nivel 2 —y por cualquier mecanismo de identidad de contenido futuro—, con un test de contrato que rompe en CI si alguna vez dejan de coincidir. Incluye plegado de mayúsculas/minúsculas (decisión explícita del usuario: "la identidad del conocimiento no debe depender de la capitalización"). Requirió una migración de datos (recálculo de `contentHash` para los `KnowledgeItem` ya existentes, sin migración de esquema). |

**Conclusión de la auditoría**: cerrado el hallazgo F, no quedan defectos conocidos en la implementación de la subfase 2.2 frente a los seis puntos auditados.

---

## Propuestas para Fase 3 (o posteriores)

Ideas de mejora arquitectónica detectadas durante la implementación de la Fase 2 que **no** se incorporan al diseño congelado — se documentan aquí para evaluación futura, sin generar deriva arquitectónica durante el desarrollo. Cada entrada debe indicar: en qué subfase se detectó, qué problema resuelve, y por qué no cumplía el criterio de cambio inmediato (arriba).

*(Sin entradas todavía — se irá completando durante la implementación de la Fase 2.)*
