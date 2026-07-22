# KnowledgeEngineModule

## Responsabilidad
Núcleo del producto (ver `docs/KNOWLEDGE_ENGINE_DESIGN.md`, Arquitectura Congelada). Subfase 2.1 ("Ingesta mínima"): conector de carga manual de archivos, gestión de `KnowledgeSource`, `IngestionJob` con sus estadísticas, normalización básica de texto. Subfase 2.2 ("Deduplicación y versionado"): niveles 1 (hash exacto) y 2 (similitud estructural) de deduplicación, con lógica real y correcta bajo concurrencia, y el grafo de linaje (arista `UPDATES` disparada automáticamente; `SPLIT_FROM`/`MERGED_FROM`/`DUPLICATE_OF`/`RESTORED_FROM` disponibles como capacidad de dominio, sin disparo automático — ver §19, §20). El nivel 3 de deduplicación existe solo como puerto/interfaz, sin lógica de comparación real (hallazgo C de la Revisión formal — Subfase 2.2). Clasificación, confianza, canonicalización, chunking, embeddings y retrieval siguen siendo responsabilidad de subfases posteriores (§19) — no están implementados todavía, ni siquiera parcialmente.

## Dependencias
`PrismaService` (global), `EncryptionService` (`common/utils/encryption.util.ts`, registrado aquí como primer consumidor real — ver `common/README.md`), `@nestjs/platform-express` (`FileInterceptor`, ya transitivo vía `multer`).

## Flujo de funcionamiento
1. `POST /knowledge-sources` crea una `KnowledgeSource` (hoy solo tiene sentido con `connectorKey: "file_upload_v1"`); su `config` se cifra con `EncryptionService` antes de guardarse (`configEnc`), aunque para este conector normalmente esté vacía.
2. `POST /knowledge-sources/:knowledgeSourceId/sync` con un archivo adjunto (`multipart/form-data`, campo `file`) dispara `IngestFromSourceUseCase.execute()`:
   - crea un `IngestionJob` (`RUNNING`) y marca la fuente `SYNCING`;
   - resuelve el conector vía `ConnectorRegistry` según `connectorKey` y llama a `extract()`;
   - por cada resultado extraído, `normalizeContent()` (`application/normalize-content.use-case.ts`) convierte el contenido crudo a texto normalizado y calcula su hash;
   - invoca el puerto de deduplicación semántica (nivel 3, no-operativo — ver más abajo) y decide el resultado de deduplicación dentro de una única transacción (`resolveAndPersist`, ver KNOWLEDGE_ENGINE_DESIGN.md §7 "Especificación de idempotencia bajo concurrencia"):
     - **nivel 1** (hash exacto, org-wide, solo contra ítems activos): si hay coincidencia, se descarta como duplicado — no se crea ningún `KnowledgeItem`;
     - **nivel 2** (similitud estructural: mismo título + misma `KnowledgeSource` actual + shingling/Jaccard, `structural-similarity.use-case.ts`, umbral configurable por organización en `Organization.settings`): si hay coincidencia por encima del umbral, se bloquea la fila del predecesor (`SELECT ... FOR UPDATE`), se crea la nueva versión, se registra la arista `UPDATES` (`KnowledgeItemLineageEdge`), el predecesor pasa a `SUPERSEDED` y se heredan sus colecciones (`KnowledgeItemCollection`);
     - si ninguno coincide, se crea un `KnowledgeItem` nuevo sin arista de linaje;
     - una violación de la restricción de unicidad parcial (`KnowledgeItem_org_contentHash_active_key`, carrera de nivel 1 entre ingestas concurrentes) se recupera como duplicado, nunca como fallo del job.
   - el `KnowledgeItem` resultante queda en `PROCESSING` (no `INDEXED`: todavía faltan clasificación/confianza/chunking/embeddings, subfases 2.3-2.6), con procedencia inmutable (`originKnowledgeSourceId`, `originIngestionJobId`) y ubicación actual (`currentKnowledgeSourceId`) — ver KNOWLEDGE_ENGINE_DESIGN.md §3.5;
   - cierra el `IngestionJob` (`SUCCESS`/`FAILED`) con sus estadísticas (`itemsFound`/`itemsCreated`/`itemsUpdated`/`itemsSkippedDuplicate`/`itemsFailed`) y actualiza el estado de la fuente (`CONNECTED`/`ERROR`). Un job donde todo lo procesado fue un duplicado exacto también cuenta como `SUCCESS` — es el comportamiento correcto de una resincronización idempotente, no un fallo.
3. `GET /knowledge-items/:knowledgeItemId` devuelve el ítem junto con su fuente y job de origen, y desde la subfase 2.2 también las aristas de linaje en ambas direcciones (`lineageEdgesAsFrom`/`lineageEdgesAsTo`) — permite verificar la trazabilidad exigida por el criterio de validación de la subfase.

## Endpoints
| Método | Ruta | Rol mínimo | Nota |
|---|---|---|---|
| `POST` | `/knowledge-sources` | `MEMBER` | Crea una fuente. |
| `GET` | `/knowledge-sources` | cualquier miembro | Lista fuentes de la organización activa. |
| `GET` | `/knowledge-sources/:knowledgeSourceId` | cualquier miembro | Detalle de una fuente (sin `configEnc`). |
| `POST` | `/knowledge-sources/:knowledgeSourceId/sync` | `MEMBER` | Sube un archivo (`multipart/form-data`, campo `file`, máx. 10&nbsp;MB) y ejecuta un ciclo de ingesta síncrono. |
| `GET` | `/knowledge-items` | cualquier miembro | Lista ítems de la organización activa. |
| `GET` | `/knowledge-items/:knowledgeItemId` | cualquier miembro | Detalle de un ítem, con su fuente y job de origen. |

Todas las rutas resuelven la organización activa por el header `x-org-id` (no por `:id`/`:organizationId` de la URL, que aquí identifican otro recurso — ver comentario en `api/knowledge-sources.controller.ts`).

## Decisiones de diseño
- **Ingesta síncrona dentro del request, sin cola todavía.** Para un único archivo subido manualmente, encolar en BullMQ/Redis (ya previsto en la arquitectura general para conectores más pesados) habría sido ceremonia sin beneficio en esta subfase. `IngestFromSourceUseCase` no asume ejecución síncrona en su contrato (devuelve una `Promise` con el resultado del job ya cerrado) — mover su invocación detrás de una cola en una subfase posterior no le exige cambios.
- **`ConnectorPort.extract()` devuelve una lista** aunque el único conector de esta subfase (`FileUploadConnector`) siempre devuelva un elemento — el contrato ya está listo para conectores que produzcan varios `KnowledgeItem` por sincronización (p. ej. una carpeta de Drive, Fase 6) sin tener que romperlo entonces.
- **`UploadedFilePayload` propio en vez de `Express.Multer.File`**: `@types/multer` no está instalado; se declaró localmente la forma mínima que este conector necesita, evitando una dependencia nueva solo para un tipo.
- **`configEnc` nunca se selecciona en las respuestas** (`PUBLIC_SELECT` en `KnowledgeSourcesService`): aunque está cifrado, no hay motivo para exponer el ciphertext a un cliente.
- **`KnowledgeItem` queda en `PROCESSING`, no `INDEXED`, al terminar esta subfase.** Por diseño (KNOWLEDGE_ENGINE_DESIGN.md §3.5): `INDEXED` significa recuperable, y la recuperación (§13) exige clasificación, confianza, canonicalización, chunking y embeddings, ninguno implementado todavía. Marcar el ítem `INDEXED` aquí sería falso.
- **Fallo parcial de un `IngestionJob`**: si al menos un `KnowledgeItem` se crea con éxito, el job se marca `SUCCESS` con el detalle del fallo en `error`; solo se marca `FAILED` si ningún ítem pudo crearse. Esto sigue KNOWLEDGE_ENGINE_DESIGN.md §3.3 ("un fallo parcial... sin descartar los que sí se procesaron"), aunque con el único conector actual (siempre 1 elemento) el caso de fallo parcial real todavía no puede darse.
- **`KnowledgeSourcesService` es un servicio plano, no un caso de uso.** Solo hace CRUD + cifrado, sin reglas de negocio no triviales — la ceremonia de capas se reserva para donde hay lógica real que proteger (`IngestFromSourceUseCase`, `normalizeContent`), siguiendo la justificación ya usada en `LlmModule` y en el plan de migración general (§3, decisión de arquitectura "Arquitectura por capas").
- **Similitud estructural por shingling + Jaccard exacto, no MinHash aproximado** (§7 nivel 2). A la escala real de esta fase (un conector, subida manual, pocos candidatos por comparación), Jaccard exacto sobre shingles de palabras da la misma calidad de detección que una aproximación, sin la complejidad ni la pérdida de precisión de MinHash — decisión presentada y aprobada antes de implementarse.
- **`SemanticDeduplicationPort` es un campo de clase con valor por defecto (`NoopSemanticDeduplication`), no un parámetro de constructor inyectado por NestJS.** Es una interfaz TypeScript sin representación en tiempo de ejecución — Nest no puede resolverla por tipo sin un token de inyección explícito, y no vale la pena introducir uno para una única implementación no-operativa (hallazgo C).
- **Índice único parcial por exclusión de estados terminales, no por inclusión de estados activos** (`KnowledgeItem_org_contentHash_active_key`, KNOWLEDGE_ENGINE_DESIGN.md §7 y §3.5). Ante un estado nuevo del ciclo de vida no clasificado todavía, el sistema falla en la dirección segura (fail-closed) — ver `knowledge-item-status.classification.ts` y su test, que rompe en CI si se añade un estado sin clasificar.
- **`KnowledgeItem_org_contentHash_active_key` y `KnowledgeItemLineageEdge_updates_from_key` son SQL manual en la migración, no `@@unique` de Prisma.** El DSL de Prisma no soporta índices únicos parciales/filtrados — mismo motivo por el que el índice HNSW de `KnowledgeChunk.embedding` ya se gestiona así desde la Fase 1.

## Ampliaciones futuras (subfases posteriores, KNOWLEDGE_ENGINE_DESIGN.md §19)
- 2.3: clasificación y confidence score inicial.
- 2.4: confianza viva (decaimiento, recálculo por eventos, curación manual).
- 2.5: canonicalización (`Canonical Knowledge Entity`).
- 2.6: chunking y embeddings.
- 2.7: pipeline de retrieval (`retrieve-context`), sin consumidores todavía.
- Conectores adicionales (Google Drive, Gmail, CRM, ERP...) — Fase 6 del plan de migración general, no de esta subfase.
