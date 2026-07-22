# KnowledgeEngineModule

## Responsabilidad
Núcleo del producto (ver `docs/KNOWLEDGE_ENGINE_DESIGN.md`, Arquitectura Congelada). Esta subfase (2.1, "Ingesta mínima") implementa solo: un conector de carga manual de archivos, gestión de `KnowledgeSource`, `IngestionJob` con sus estadísticas, y normalización básica de texto. Deduplicación, versionado, clasificación, confianza, canonicalización, chunking, embeddings y retrieval son responsabilidad de subfases posteriores (§19 del documento de diseño) — no están implementados todavía, ni siquiera parcialmente.

## Dependencias
`PrismaService` (global), `EncryptionService` (`common/utils/encryption.util.ts`, registrado aquí como primer consumidor real — ver `common/README.md`), `@nestjs/platform-express` (`FileInterceptor`, ya transitivo vía `multer`).

## Flujo de funcionamiento
1. `POST /knowledge-sources` crea una `KnowledgeSource` (hoy solo tiene sentido con `connectorKey: "file_upload_v1"`); su `config` se cifra con `EncryptionService` antes de guardarse (`configEnc`), aunque para este conector normalmente esté vacía.
2. `POST /knowledge-sources/:knowledgeSourceId/sync` con un archivo adjunto (`multipart/form-data`, campo `file`) dispara `IngestFromSourceUseCase.execute()`:
   - crea un `IngestionJob` (`RUNNING`) y marca la fuente `SYNCING`;
   - resuelve el conector vía `ConnectorRegistry` según `connectorKey` y llama a `extract()`;
   - por cada resultado extraído, `normalizeContent()` (`application/normalize-content.use-case.ts`) convierte el contenido crudo a texto normalizado y calcula su hash;
   - crea un `KnowledgeItem` en estado `PROCESSING` (no `INDEXED`: todavía faltan clasificación/confianza/chunking/embeddings, subfases 2.3-2.6) con procedencia inmutable (`originKnowledgeSourceId`, `originIngestionJobId`) y ubicación actual (`currentKnowledgeSourceId`) — ver KNOWLEDGE_ENGINE_DESIGN.md §3.5;
   - cierra el `IngestionJob` (`SUCCESS`/`FAILED`) con sus estadísticas (`itemsFound`/`itemsCreated`/`itemsFailed`) y actualiza el estado de la fuente (`CONNECTED`/`ERROR`).
3. `GET /knowledge-items/:knowledgeItemId` devuelve el ítem junto con su fuente y job de origen — permite verificar la trazabilidad exigida por el criterio de validación de esta subfase.

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

## Ampliaciones futuras (subfases posteriores, KNOWLEDGE_ENGINE_DESIGN.md §19)
- 2.2: deduplicación (hash exacto → estructural → semántica) y versionado (grafo de linaje).
- 2.3: clasificación y confidence score inicial.
- 2.4: confianza viva (decaimiento, recálculo por eventos, curación manual).
- 2.5: canonicalización (`Canonical Knowledge Entity`).
- 2.6: chunking y embeddings.
- 2.7: pipeline de retrieval (`retrieve-context`), sin consumidores todavía.
- Conectores adicionales (Google Drive, Gmail, CRM, ERP...) — Fase 6 del plan de migración general, no de esta subfase.
