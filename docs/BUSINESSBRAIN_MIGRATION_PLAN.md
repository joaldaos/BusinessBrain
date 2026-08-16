# Plan de Migración Técnica: Drop → BusinessBrain

**Estado:** Documento definitivo de arquitectura — base para el desarrollo.
**Alcance:** Solo diseño. No incluye implementación de código de aplicación (el schema de Prisma se define como parte del "modelo de datos", tal como se solicitó).

---

## 1. Resumen ejecutivo

Drop es una app social de música (feed, playlists, trending, gamificación, integración con Spotify) construida sobre **Express + almacenamiento en memoria + React**. No existe todavía backend NestJS ni base de datos con Prisma: son stack nuevo a introducir, no una migración de código 1:1.

BusinessBrain es un producto distinto: **una plataforma SaaS B2B multi-tenant impulsada por IA que centraliza el conocimiento operativo de una empresa** (documentos, CRM, ERP, bases de datos, webs, redes sociales) para que los equipos puedan:

- Consultar esa información en lenguaje natural con respuestas contextualizadas (RAG).
- Automatizar procesos y generar informes.
- Recibir recomendaciones generadas por IA.
- Operar agentes de IA especializados por área (ventas, marketing, atención al cliente, operaciones, finanzas, RR. HH.).

Este documento define: qué se conserva de Drop, qué se elimina, la arquitectura nueva, la estructura definitiva del backend (NestJS), el modelo de datos completo (Prisma), los módulos del backend, el frontend (React) y el roadmap de migración por fases.

---

## 2. Auditoría del proyecto actual

### 2.1 Stack actual (real, verificado en el repo)

| Capa | Tecnología actual |
|---|---|
| Backend | Node.js + Express 5, sin framework de estructura |
| Persistencia | `Map()` en memoria (`server/store/memory.js`) — no hay base de datos |
| Auth | JWT manual (`jsonwebtoken`) + `bcryptjs`, middleware artesanal |
| Frontend | React 18 + Vite + React Router 7 + Tailwind + i18next |
| Otros | `pdfkit` (generación PDF), integración OAuth con Spotify |

No hay NestJS ni Prisma en el proyecto actual — se introducen como stack nuevo para BusinessBrain, no se "migran".

### 2.2 Qué se conserva (arquitectura técnica útil)

Estos patrones son agnósticos al dominio musical y se reutilizan, **reimplementados** sobre NestJS:

- **Modelo de autenticación JWT** (`server/middleware/auth.js`, `server/routes/auth.js`): login/registro con bcrypt, token firmado, guard de autenticación, guard de rol admin, auth opcional. → Se convierte en `AuthModule` con Passport (`JwtStrategy`, `LocalStrategy`) y Guards de NestJS.
- **Patrón de roles y panel de administración** (`server/routes/admin.js`): estadísticas agregadas, listado paginado de usuarios, ban/unban, cambio de plan, cambio de rol. → Se convierte en `AdminModule` a nivel de plataforma (superadmin), evolucionado a multi-tenant.
- **Concepto de "plan"** (`free/pro/creator` en `memory.js`): se conserva como **tier de suscripción de la organización** (`FREE/PRO/ENTERPRISE`).
- **Concepto de invitaciones** (`inviteCodes` en `memory.js`): se conserva y se generaliza como invitaciones a una organización (multi-tenant onboarding).
- **Patrón de rutas Express modulares y middleware de CORS/salud** (`server/index.js`): se traduce a módulos NestJS + `HealthModule`.
- **Generación de PDF** (`pdfkit`): se conserva como motor de exportación de informes (`ReportsModule`).
- **Patrón de proxy de imágenes remotas** (`/api/imgproxy`): técnica reutilizable de forma genérica si se necesita servir adjuntos/imágenes de fuentes externas (queda como utilidad de `CommonModule`, ya no ligada a Spotify).
- **Frontend**: Vite + React Router + Tailwind + i18next + estructura `context/` + `pages/` + `components/` se conserva como esqueleto; se migra a **TypeScript** y se reescribe el contenido de página por página (ver sección 8).
- **Componentes de layout reutilizables**: `Navbar`, `Footer`, `AuthModal`, `Notification`, `PlanBadge` — se conservan como piezas de UI, adaptando su contenido/props al nuevo dominio.

### 2.3 Qué se elimina por completo

Todo el dominio de música/Spotify/artistas/publicaciones sociales desaparece:

**Backend:**
- `server/routes/spotify.js`, `server/routes/feed.js`, `server/routes/trending.js`, `server/routes/share.js`
- `server/engine/gamification.js`, `server/engine/recommendation.js` (motor de XP/badges/recomendación musical — no reutilizable, se sustituye por un motor de recomendaciones basado en LLM, ver §7.5)
- Endpoint `/api/auth/spotify` y `/api/auth/spotify/callback` (OAuth PKCE específico de Spotify — el *patrón* OAuth se reutiliza de forma genérica en `IntegrationsModule`, el código específico no)
- Entidades en memoria: `events`, `trackStats`, `cityStats` y sus helpers (`createEvent`, `registerPlay`, `registerCityActivity`)
- Campos de usuario musicales: `spotifyConnected`, `spotifyTokens`, `spotifyId`, `history`, `likedEvents`, `sharedEvents`, `xp`, `level`, `badges`, `loginStreak`, `viralPicks`

**Frontend:**
- Páginas: `Discover.jsx`, `Feed.jsx`, `Playlists.jsx`, `Trending.jsx`, `Search.jsx` (búsqueda musical)
- Componentes: `FeedCard.jsx`, `PlaylistCard.jsx`, `CreatePlaylistModal.jsx`, `Waveform.jsx`, `Ticker.jsx`, `PhoneMockup.jsx`
- Componentes de landing con contenido musical (`Hero`, `Features`, `HowItWorks`, `SocialProof`, `Stats`, `CTA`): se conserva el *layout* pero se reescribe todo el copy/contenido para BusinessBrain.

---

## 3. Arquitectura general de BusinessBrain

> **Corrección tras revisión arquitectónica (v1.1):** el diagrama original colocaba el chat como centro y los proveedores de IA como un bloque genérico "adosado". Se corrige para reflejar que el **Knowledge Engine es el núcleo del producto**, que el chat es una superficie de consumo entre varias, y que la capa de proveedores LLM es un componente desacoplado propio, no un detalle de infraestructura.

```
                         ┌────────────────────────────────────────────┐
                         │              Frontend (React)                 │
                         │  Chat · Agentes · Automatizaciones · Informes  │
                         │  Conocimiento · Integraciones · Admin          │
                         └───────────────────┬────────────────────────┘
                                             │ REST + WebSocket/SSE
                         ┌───────────────────▼────────────────────────┐
                         │                NestJS API                    │
                         │      módulos funcionales · guards RBAC        │
                         │            multi-tenant                       │
                         └───┬────────────────┬──────────────┬─────────┘
                             │                │              │
                 ┌───────────▼──────┐  ┌──────▼───────┐  ┌───▼─────────────────┐
                 │  KNOWLEDGE ENGINE  │  │  LLM PROVIDER  │  │  Superficies de       │
                 │  (núcleo del       │◄─┤     LAYER      │  │  consumo (pares):     │
                 │   producto)        │  │  Anthropic /   │  │  Chat · Agentes ·     │
                 │  normalización ·   │  │  OpenAI /      │  │  Automatizaciones ·   │
                 │  clasificación ·   │  │  Gemini /      │  │  Informes · API        │
                 │  dedup · versión · │  │  Mistral /     │  │  pública               │
                 │  confianza ·       │  │  Ollama        │  │                        │
                 │  embeddings        │  └────────────────┘  └────────────────────────┘
                 └─────────┬──────────┘
                           │
              ┌────────────▼──────────────┐
              │  PostgreSQL + pgvector      │
              │  (Prisma) · Redis (BullMQ:  │
              │  ingestion jobs, runs de    │
              │  agentes/automatizaciones)  │
              └────────────┬───────────────┘
                           │
       ┌───────────────────▼──────────────────────────────────┐
       │  Connectors: subida de archivos, Google Drive, Gmail,   │
       │  CRM (HubSpot/Salesforce), ERP, webs, redes sociales,    │
       │  bases de datos externas                                 │
       └─────────────────────────────────────────────────────┘
```

El chat, los agentes, las automatizaciones y los informes son **superficies de consumo**, nunca el núcleo. Acceden al conocimiento a través de un único caso de uso de recuperación (`retrieve-context`) y a la comprensión derivada a través del único punto de lectura del Understanding Engine (`RetrieveInsights`, [`docs/UNDERSTANDING_ENGINE_DESIGN.md`](./UNDERSTANDING_ENGINE_DESIGN.md) §12); ninguna tiene acceso privilegiado ni un camino de datos distinto a las demás.

**Los dos motores están ordenados, no son intercambiables.** El Knowledge Engine responde *qué sabe la organización*; el Understanding Engine responde *qué significa* — y consume el primero exclusivamente a través de sus contratos declarados, nunca accediendo a `KnowledgeChunk` por su cuenta. A partir de la Fase 4, una superficie conversacional que necesite comprensión la pide al Understanding Engine; no la reconstruye por su cuenta a partir de fragmentos recuperados.

### 3.1 Decisiones de arquitectura clave

| Decisión | Elección | Justificación |
|---|---|---|
| Estilo de backend | **Monolito modular NestJS** (no microservicios desde el día 1) | Menor complejidad operativa inicial; los módulos (`IngestionModule`, `AgentsModule`, etc.) están desacoplados internamente para poder extraerse a servicios independientes más adelante si el volumen lo justifica. |
| Multi-tenancy | **Base de datos compartida, esquema compartido**, discriminador `organizationId` en cada tabla con datos de tenant | Más simple de operar y migrar que "esquema por tenant" o "DB por tenant"; se refuerza con un `PrismaService` que inyecta el filtro de organización automáticamente y, en fase de hardening, con **Row-Level Security (RLS)** de Postgres como segunda capa de defensa. |
| Base de datos vectorial | **pgvector sobre la misma PostgreSQL** (no un vector DB separado) | Evita operar un sistema adicional al empezar; una tabla (`KnowledgeChunk`) con columna `vector` e índice HNSW cubre el caso de uso de recuperación semántica por organización. Documentado el camino de escalado a Pinecone/Weaviate si el volumen de vectores lo exige. |
| Colas / procesos asíncronos | **BullMQ + Redis** | La ingesta (`IngestionJob`), generación de embeddings, ejecución de agentes/automatizaciones y reports son operaciones largas y deben desacoplarse del ciclo request/response. |
| **Núcleo del producto** *(v1.1)* | **Knowledge Engine** (`KnowledgeSource → IngestionJob → KnowledgeItem → KnowledgeChunk`, con versionado y confianza) como dominio central; `Conversation`/`Message` es una superficie de consumo más, no el centro del modelo | Evita acoplar el modelo de datos a la interfaz de chat. Agentes, automatizaciones e informes deben poder consumir el mismo conocimiento versionado sin depender de una transcripción de chat como fuente de verdad. |
| **Proveedor de IA** *(v1.1)* | **Multi-proveedor desde el día 1** vía `LlmProviderPort` + `ProviderRegistry`, seleccionable por organización o por agente (Anthropic, OpenAI, Gemini, Mistral, Ollama), sin proveedor "por defecto" fijado en código | Evita lock-in con un proveedor; permite a cada cliente usar el que ya tiene contratado, aplicar Ollama on-prem por requisitos de residencia de datos, o traer su propia API key (`LlmProfile.apiKeyEnc`). |
| **Arquitectura por capas** *(v1.1)* | **Híbrida**: Domain/Application/Infrastructure explícitos solo en los módulos con lógica de dominio real (`knowledge-engine`, `llm`, `agents`, `automations`); estructura plana (controller/service) en módulos de soporte (`auth`, `users`, `organizations`, `billing`, `notifications`, `api-keys`, `admin`, `audit`, `health`) | Layering completo en un CRUD de notificaciones añade ceremonia sin beneficio. El valor de separar capas está donde hay reglas de negocio no triviales que proteger de detalles de infraestructura (parseo de conectores, scoring, orquestación de agentes con permisos/memoria). |
| Autenticación | **JWT access + refresh token**, Passport.js | Continuidad directa del patrón ya usado en Drop, ahora con refresh tokens (ausentes en Drop) por ser SaaS de uso prolongado. |
| Autorización | **RBAC de dos niveles**: rol global de plataforma (`USER` / `SUPERADMIN`) + rol dentro de organización (`OWNER` / `ADMIN` / `MEMBER` / `VIEWER`) | Refleja que BusinessBrain es multi-tenant: el admin de Drop se convierte en superadmin de plataforma; se añade un rol de administración *por organización*, que no existía en Drop. Los agentes añaden un tercer nivel de permisos propio (§7.4). |
| Frontend | **React + TypeScript** (migración de JS a TS), Vite, TanStack Query para estado de servidor | TypeScript es necesario dado el volumen de tipos compartidos con el backend (DTOs); TanStack Query sustituye el fetch manual actual en `AppContext.jsx`. |
| **Extensibilidad de agentes** *(v1.1)* | `AgentTemplate` modelado desde ahora (visibilidad `PRIVATE/ORGANIZATION/PUBLIC`, `publisherOrgId` opcional), sin construir marketplace todavía | Añadir esto después de tener `Agent` en producción obligaría a una migración de datos; modelarlo ahora tiene coste marginal. |

### 3.2 Principios permanentes de producto

Principios que aplican a BusinessBrain como producto completo — no a un módulo concreto — y que, como tales, se referencian desde cualquier documento de arquitectura de un subsistema en vez de repetirse en cada uno.

#### Principio de Evolución Asistida

BusinessBrain está diseñado para evolucionar continuamente junto con la empresa y con su entorno. No debe limitarse a ejecutar procesos existentes; debe ser capaz de detectar oportunidades objetivas de mejora en la organización, en sus procesos, en su conocimiento y en las tecnologías que utiliza.

Para ello podrá analizar de forma continua, entre otros aspectos: cambios en el negocio, cambios legislativos, nuevas tecnologías, nuevas integraciones disponibles, cambios en los hábitos de clientes, cambios en procesos internos, pérdida de eficiencia, redundancias, conocimiento obsoleto y nuevas oportunidades detectadas.

**Aislamiento multi-tenant.** Todo análisis que compare señales entre distintas organizaciones se realiza sobre datos agregados o anonimizados — nunca exponiendo el contexto específico de una organización a otra. Esto extiende a nivel de producto el mismo principio ya exigido como requisito de diseño del Knowledge Engine ("Multi-tenant por diseño", `KNOWLEDGE_ENGINE_DESIGN.md` §2): ninguna capacidad de análisis, ni siquiera una agregada, puede filtrar el contexto de una organización hacia otra.

Cuando detecte una mejora relevante deberá:
1. Explicar qué ha detectado.
2. Justificar por qué considera que es una mejora.
3. Estimar el impacto esperado.
4. Explicar ventajas e inconvenientes.
5. Indicar qué partes del sistema se verían afectadas.
6. Proponer un plan de migración. Este apartado nunca se omite: si el cambio propuesto no requiere migración, el apartado se completa explícitamente como *"Plan de migración: no aplica (sin impacto estructural)"*, en vez de dejarse en blanco u omitirse. El formato de toda propuesta es siempre el mismo, precisamente para que decidir si el plan de migración "hace falta" nunca quede a criterio de quien genera la propuesta.

**Regla fundamental.** BusinessBrain puede proponer mejoras en cualquier momento. BusinessBrain nunca modificará automáticamente la arquitectura, el modelo de conocimiento, los procesos, las reglas de negocio ni el comportamiento operativo sin aprobación explícita de la empresa. Debe existir siempre trazabilidad completa de cualquier evolución. Los criterios que determinan si una mejora es "relevante" son configuración explícita, ajustable por organización, con valores por defecto de plataforma — nunca constantes fijadas en el código, mismo criterio ya exigido para los umbrales cualitativos del Knowledge Engine (`KNOWLEDGE_ENGINE_DESIGN.md`, hallazgo #10 de la auditoría previa a la congelación).

**Vehículo de producto.** La entidad `Recommendation` (`NEW`/`ACCEPTED`/`DISMISSED`, ver §6 y §7.2) es el vehículo por el que estas propuestas se presentan a la empresa. El mecanismo "Propuestas de evolución futura" del Knowledge Engine es su variante acotada al desarrollo interno, para hallazgos de arquitectura detectados por el propio equipo durante la implementación. Ambos son expresiones del mismo principio — proponer, nunca imponer, siempre trazable — no mecanismos independientes ni redundantes entre sí.

**Filosofía.** BusinessBrain no pretende convertirse en un software estático. Su objetivo es convertirse en un sistema operativo empresarial capaz de evolucionar durante años sin quedarse obsoleto. La evolución continua es una capacidad del sistema. La decisión de evolucionar siempre pertenece a la empresa.

Esto refleja el objetivo de fondo de todo el producto, más allá de la capacidad concreta de proponer mejoras: **BusinessBrain no tiene como objetivo responder preguntas — tiene como objetivo comprender el funcionamiento completo de una empresa y trabajar de forma proactiva para mejorarla.** Toda propuesta de mejora generada bajo este principio se evalúa según un único criterio: *¿ayuda a que BusinessBrain comprenda mejor la empresa y pueda trabajar mejor para ella?* Si la respuesta es no, esa funcionalidad no forma parte de la visión del producto, con independencia de su elegancia técnica o de lo sencilla que sea de construir.

> **Relación con el principio ya existente en el Knowledge Engine.** `KNOWLEDGE_ENGINE_DESIGN.md` §2 fija un principio equivalente pero de alcance distinto: *"toda decisión [de diseño o implementación, de cualquier módulo] se evalúa por su aporte a la comprensión del negocio."* Ese principio gobierna las decisiones de quienes construyen BusinessBrain (en tiempo de desarrollo); el criterio de esta sección gobierna lo que el propio BusinessBrain, ya en producción, decide proponerle a la empresa (en tiempo de ejecución). Son dos aplicaciones del mismo valor de fondo, sobre dos actores y dos momentos distintos — quién decide qué construir, y qué decide proponer el sistema una vez construido — no una duplicación.

---

## 4. Estructura definitiva del backend (NestJS)

> **Actualización v1.1:** tras la revisión arquitectónica, `data-sources`, `ingestion` y `knowledge` se fusionan en un único bounded context `knowledge-engine` (el núcleo del producto), `ai` se renombra a `llm` (capa de proveedor desacoplada), y los módulos núcleo (`knowledge-engine`, `llm`, `agents`, `automations`) adoptan capas `domain/application/infrastructure` explícitas. Los módulos de soporte mantienen la estructura plana original — ver justificación en §3.

```
backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── config/
│   │   ├── configuration.ts          # carga de env vars tipadas
│   │   └── env.validation.ts         # validación (zod/Joi) al boot
│   │
│   ├── common/
│   │   ├── decorators/               # @CurrentUser, @CurrentOrg, @Roles, @Public
│   │   ├── guards/                   # JwtAuthGuard, OrgRoleGuard, PlanLimitGuard
│   │   ├── interceptors/             # AuditInterceptor, TransformResponseInterceptor
│   │   ├── filters/                  # AllExceptionsFilter
│   │   ├── pipes/                    # ZodValidationPipe / class-validator config
│   │   └── utils/                    # encryption.util.ts (secrets), pagination.util.ts
│   │
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   ├── prisma.service.ts         # extiende PrismaClient, gestiona tenant scoping
│   │   └── schema.prisma
│   │
│   ├── auth/                          # módulo de soporte — estructura plana
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts        # /auth/register /auth/login /auth/refresh /auth/logout /auth/me
│   │   ├── auth.service.ts
│   │   ├── strategies/                # jwt.strategy.ts, local.strategy.ts
│   │   └── dto/
│   │
│   ├── users/                         # módulo de soporte — estructura plana
│   │   ├── users.module.ts
│   │   ├── users.controller.ts       # /users/me (GET/PATCH)
│   │   └── users.service.ts
│   │
│   ├── organizations/                 # módulo de soporte — estructura plana
│   │   ├── organizations.module.ts
│   │   ├── organizations.controller.ts  # /organizations, /organizations/:id, /organizations/:id/members
│   │   ├── invitations.controller.ts    # /organizations/:id/invitations
│   │   └── organizations.service.ts
│   │
│   ├── billing/                        # módulo de soporte — estructura plana
│   │   ├── billing.module.ts
│   │   ├── billing.controller.ts     # /billing/plans /billing/subscribe /billing/webhook
│   │   └── billing.service.ts        # integración Stripe (o similar)
│   │
│   ├── knowledge-engine/               # ★ NÚCLEO DEL PRODUCTO — capas domain/application/infrastructure
│   │   ├── knowledge-engine.module.ts
│   │   ├── api/
│   │   │   ├── knowledge-sources.controller.ts     # /knowledge-sources CRUD + /:id/sync
│   │   │   ├── knowledge-items.controller.ts       # /knowledge-items (lectura, historial de versiones, /:id/reindex)
│   │   │   ├── knowledge-collections.controller.ts # /knowledge-collections CRUD
│   │   │   └── knowledge-search.controller.ts      # /knowledge/search (debug de recuperación semántica)
│   │   ├── domain/
│   │   │   ├── entities/               # KnowledgeSource, KnowledgeItem, KnowledgeChunk, IngestionJob
│   │   │   ├── value-objects/          # ContentHash, ConfidenceScore, Classification
│   │   │   └── ports/                  # ConnectorPort, ClassifierPort, DeduplicatorPort
│   │   ├── application/
│   │   │   ├── ingest-from-source.use-case.ts      # Connector → IngestionJob
│   │   │   ├── normalize-content.use-case.ts
│   │   │   ├── classify-content.use-case.ts
│   │   │   ├── deduplicate-content.use-case.ts     # hash de contenido vs. KnowledgeItem existentes
│   │   │   ├── version-knowledge-item.use-case.ts  # crea nueva versión, marca la anterior SUPERSEDED
│   │   │   ├── score-confidence.use-case.ts
│   │   │   └── retrieve-context.use-case.ts        # único punto de recuperación semántica para TODO consumidor
│   │   ├── infrastructure/
│   │   │   ├── connectors/             # file-upload, google-drive, gmail, hubspot, salesforce, sap, web-scraper...
│   │   │   ├── repositories/           # PrismaKnowledgeSourceRepository, PrismaKnowledgeItemRepository...
│   │   │   └── embedding/              # adaptador hacia llm/ para generar embeddings
│   │   └── workers/
│   │       ├── ingestion-job.processor.ts          # ejecuta el pipeline completo de un IngestionJob
│   │       └── reindex-job.processor.ts
│   │
│   ├── llm/                            # ★ NÚCLEO — capa de proveedor de IA desacoplada (antes "ai/")
│   │   ├── llm.module.ts
│   │   ├── domain/
│   │   │   └── ports/
│   │   │       ├── llm-provider.port.ts
│   │   │       └── embedding-provider.port.ts
│   │   ├── application/
│   │   │   ├── provider-registry.service.ts        # resuelve el proveedor activo por organización/agente
│   │   │   └── prompt-builder.service.ts
│   │   └── infrastructure/
│   │       └── providers/
│   │           ├── anthropic.provider.ts
│   │           ├── openai.provider.ts
│   │           ├── gemini.provider.ts
│   │           ├── mistral.provider.ts
│   │           └── ollama.provider.ts               # modelos locales / on-prem
│   │
│   ├── agents/                         # ★ NÚCLEO — capas domain/application/infrastructure
│   │   ├── agents.module.ts
│   │   ├── api/
│   │   │   ├── agents.controller.ts                # /agents CRUD + /:id/test
│   │   │   └── agent-templates.controller.ts       # /agent-templates (catálogo; groundwork de marketplace)
│   │   ├── domain/
│   │   │   ├── entities/               # Agent, AgentTemplate, AgentMemory
│   │   │   └── ports/                  # ToolPort, MemoryStorePort
│   │   ├── application/
│   │   │   ├── run-agent.use-case.ts               # orquesta: knowledge scope + tools + memoria + políticas
│   │   │   ├── install-agent-template.use-case.ts  # instancia un Agent a partir de un AgentTemplate
│   │   │   └── enforce-agent-policy.use-case.ts    # valida guardrails antes de ejecutar una tool
│   │   └── infrastructure/
│   │       ├── tools/                  # sql-tool, http-tool, send-email-tool, report-tool...
│   │       └── repositories/
│   │
│   ├── conversations/                   # superficie de consumo — estructura plana
│   │   ├── conversations.module.ts
│   │   ├── conversations.controller.ts # /conversations CRUD
│   │   ├── messages.controller.ts      # /conversations/:id/messages (POST → retrieve-context + run-agent)
│   │   ├── messages.gateway.ts         # WebSocket/SSE streaming de respuesta
│   │   └── conversations.service.ts    # delega en knowledge-engine y agents, no contiene lógica de dominio propia
│   │
│   ├── recommendations/                 # superficie de consumo — estructura plana
│   │   ├── recommendations.module.ts
│   │   ├── recommendations.controller.ts  # /recommendations (list, dismiss, accept)
│   │   └── recommendations.service.ts
│   │
│   ├── automations/                     # ★ núcleo parcial — capas domain/application + workers
│   │   ├── automations.module.ts
│   │   ├── api/
│   │   │   └── automations.controller.ts   # /automations CRUD + /:id/runs
│   │   ├── domain/
│   │   │   └── entities/                   # Automation, AutomationRun
│   │   ├── application/
│   │   │   ├── run-automation.use-case.ts
│   │   │   └── schedule-automation.use-case.ts  # @nestjs/schedule + BullMQ repeatable jobs
│   │   └── workers/
│   │       └── automation-run.processor.ts
│   │
│   ├── reports/                         # superficie de consumo — estructura plana
│   │   ├── reports.module.ts
│   │   ├── reports.controller.ts       # /reports CRUD + /:id/generate + /:id/runs
│   │   ├── generators/
│   │   │   └── pdf.generator.ts        # reutiliza pdfkit
│   │   └── reports.service.ts
│   │
│   ├── integrations/                    # módulo de soporte — estructura plana
│   │   ├── integrations.module.ts
│   │   ├── integrations.controller.ts  # /integrations, /integrations/:provider/connect|callback
│   │   ├── connectors/                 # hubspot, salesforce, google-drive, slack, sap...
│   │   └── integrations.service.ts
│   │
│   ├── notifications/                   # módulo de soporte — estructura plana
│   │   ├── notifications.module.ts
│   │   ├── notifications.controller.ts  # /notifications, /:id/read
│   │   ├── notifications.gateway.ts     # WebSocket realtime
│   │   └── notifications.service.ts
│   │
│   ├── api-keys/                        # módulo de soporte — estructura plana
│   │   ├── api-keys.module.ts
│   │   └── api-keys.controller.ts      # /api-keys CRUD (acceso programático por organización)
│   │
│   ├── admin/                          # módulo de soporte — superadmin de plataforma (evolución de admin.js)
│   │   ├── admin.module.ts
│   │   ├── admin.controller.ts         # /admin/stats /admin/organizations /admin/users
│   │   └── admin.service.ts
│   │
│   ├── audit/                          # módulo de soporte — estructura plana
│   │   ├── audit.module.ts
│   │   └── audit.service.ts            # inyectado transversalmente vía AuditInterceptor
│   │
│   └── health/                         # módulo de soporte — estructura plana
│       ├── health.module.ts
│       └── health.controller.ts        # /health (equivalente a /api/health de Drop)
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                         # equivalente a server/store/seed.js
│
├── test/
├── .env.example
├── nest-cli.json
├── tsconfig.json
└── package.json
```

**Convención de guards por módulo:** todo controller de dominio (excepto `auth`, `health`, y callbacks OAuth públicos) aplica `JwtAuthGuard` + `OrgRoleGuard` a nivel de módulo, resolviendo la organización activa desde el JWT o desde un header `X-Org-Id` validado contra las membresías del usuario. `admin.controller.ts` aplica en su lugar `SuperAdminGuard` (rol de plataforma, no de organización). En `agents/`, además, `enforce-agent-policy.use-case.ts` aplica un tercer nivel de permisos (§7.4): un usuario puede tener rol `MEMBER` en la organización y aun así no tener permiso para que un agente concreto ejecute una tool con efectos (p. ej. enviar un email).

---

## 5. Módulos de NestJS — responsabilidades y endpoints

| Módulo | Responsabilidad | Endpoints principales | Notas |
|---|---|---|---|
| `AuthModule` | Registro, login, refresh, sesión | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | Evolución directa de `server/routes/auth.js` + `middleware/auth.js`, sin las partes de Spotify. |
| `UsersModule` | Perfil de usuario global | `GET/PATCH /users/me` | |
| `OrganizationsModule` | Tenants, membresías, invitaciones | `POST /organizations`, `GET/PATCH /organizations/:id`, `GET /organizations/:id/members`, `POST /organizations/:id/invitations`, `POST /invitations/:token/accept` | Generaliza `inviteCodes` de Drop a invitaciones de organización. |
| `BillingModule` | Planes y suscripción | `GET /billing/plans`, `POST /billing/subscribe`, `POST /billing/webhook` | Integración con pasarela de pago (Stripe u otra) a definir en fase 7. |
| `KnowledgeEngineModule` ★ *(v1.1, núcleo)* | **Bounded context central**: fuentes de conocimiento, ejecuciones de ingesta, normalización, clasificación, deduplicación, versionado, cálculo de confianza, embeddings y búsqueda semántica. Sustituye a los antiguos `DataSourcesModule` + `IngestionModule` + `KnowledgeModule`, que trataban la ingesta como soporte del chat en vez de como el dominio principal. | `GET/POST /knowledge-sources`, `PATCH/DELETE /knowledge-sources/:id`, `POST /knowledge-sources/:id/sync`, `GET /knowledge-items/:id` (incluye historial de versiones), `POST /knowledge-items/:id/reindex`, `GET/POST /knowledge-collections`, `POST /knowledge/search` | Toda ejecución de ingesta queda registrada como `IngestionJob` propio (no solo como cambio de estado en el documento), con estadísticas de items creados/actualizados/duplicados/fallidos. |
| `LlmModule` ★ *(v1.1, núcleo, antes `AiModule`)* | Abstracción de proveedor LLM/embeddings mediante `ProviderRegistry`; sin proveedor por defecto fijado en código | Sin HTTP público; servicio interno consumido por `knowledge-engine`, `conversations`, `agents`, `recommendations`, `automations` | Soporta Anthropic, OpenAI, Gemini, Mistral y Ollama vía `LlmProfile` (configuración por organización o por agente, incluida API key propia del cliente). |
| `UnderstandingEngineModule` ★ *(v1.2, núcleo)* | **Bounded context de la comprensión**: ejecuciones de razonamiento, `Insight` con evidencia trazable y confianza compuesta, objetivos de negocio y gate de riesgo/oportunidad, curación humana y puente con `Recommendation`. Consume el Knowledge Engine solo por contratos declarados, nunca `KnowledgeChunk` directo. Especificado en [`docs/UNDERSTANDING_ENGINE_DESIGN.md`](./UNDERSTANDING_ENGINE_DESIGN.md) (🧊 congelado v1.0) | Expuesto por HTTP desde 5.5/6.1 (`GET /insights`, `POST /analysis-runs`, `POST /insights/:id/curate`, `/escalate`, `/history`). `RetrieveInsights` sigue siendo el único punto de lectura de comprensión | Único punto de lectura de comprensión para toda superficie futura. Nunca ejecuta acciones: cualquier acción pasa por el Principio de Evolución Asistida (§3.2). |
| `ConversationsModule` *(superficie de consumo, no el núcleo)* | Interfaz de chat sobre el Understanding Engine, el Knowledge Engine y los Agentes | `GET/POST /conversations`, `GET /conversations/:id`, `POST /conversations/:id/messages`, streaming vía WS/SSE | Delega la comprensión en `RetrieveInsights` del `understanding-engine` y la recuperación de contexto en `retrieve-context.use-case` de `knowledge-engine`; no contiene lógica de RAG ni de razonamiento propia. |
| `AgentsModule` ★ *(v1.1, núcleo)* | Definición, permisos y ejecución de agentes especializados por área; además, catálogo de plantillas instalables (groundwork de marketplace) | `GET/POST /agents`, `PATCH/DELETE /agents/:id`, `POST /agents/:id/test`, `GET /agent-templates`, `POST /agent-templates/:id/install` | `Agent` incluye `capabilities`, `tools` (con permiso por herramienta), `memoryConfig`, `guardrails` y alcance de conocimiento (`knowledgeCollections`) — no es solo un system prompt. `area` ∈ {ventas, marketing, soporte, operaciones, finanzas, RR. HH., general}. |
| `RecommendationsModule` | Recomendaciones generadas por IA a partir del Knowledge Engine | `GET /recommendations`, `POST /recommendations/:id/accept`, `POST /recommendations/:id/dismiss` | Sustituye conceptualmente a `engine/recommendation.js`, ahora basado en LLM sobre conocimiento real e indexado de la org, no en reglas fijas. |
| `AutomationsModule` ★ *(v1.1, núcleo parcial)* | Flujos disparados por evento/horario, orquestando Knowledge Engine y Agentes | `GET/POST /automations`, `PATCH/DELETE /automations/:id`, `GET /automations/:id/runs` | Programación con `@nestjs/schedule` + jobs repetibles de BullMQ. |
| `ReportsModule` | Informes generados (bajo demanda o programados) | `GET/POST /reports`, `POST /reports/:id/generate`, `GET /reports/:id/runs` | Reutiliza `pdfkit` ya presente en el proyecto. |
| `IntegrationsModule` | Conexiones OAuth a sistemas externos (CRM/ERP/Drive/Slack…) | `GET /integrations`, `GET /integrations/:provider/connect`, `GET /integrations/:provider/callback`, `DELETE /integrations/:id` | Generaliza el patrón OAuth de `auth.js` (Spotify) a cualquier proveedor. |
| `NotificationsModule` | Notificaciones in-app | `GET /notifications`, `POST /notifications/:id/read`, WS gateway | |
| `ApiKeysModule` | Acceso programático a la API de una organización | `GET/POST /api-keys`, `DELETE /api-keys/:id` | |
| `AdminModule` | Panel de superadmin de plataforma | `GET /admin/stats`, `GET /admin/organizations`, `GET /admin/users`, `POST /admin/users/:id/ban`, `POST /admin/organizations/:id/plan` | Evolución directa de `server/routes/admin.js`. |
| `AuditModule` | Registro de auditoría transversal | `GET /admin/audit-logs` (lectura) | Alimentado por `AuditInterceptor` en el resto de módulos. |
| `HealthModule` | Salud del servicio | `GET /health` | Equivalente a `/api/health` de Drop. |

---

## 6. Modelo de datos completo (Prisma)

> **Revisión v1.1 — cambios respecto a la versión anterior:**
> - `DataSource` → **`KnowledgeSource`**, `Document` → **`KnowledgeItem`**, `DocumentChunk` → **`KnowledgeChunk`**, `KnowledgeBase` → **`KnowledgeCollection`**: renombrados para reflejar que el conocimiento (no el chat) es el dominio central.
> - Nueva entidad **`IngestionJob`**: cada ejecución de sincronización de una `KnowledgeSource` queda registrada (antes solo existía como campo de estado, sin histórico).
> - `KnowledgeItem` incorpora **deduplicación** (`contentHash`), **versionado** (`version`, `supersedesId`, `isCanonical`) y **confianza** (`confidenceScore`, `classification`) — no existían en la versión anterior.
> - `Agent` se amplía con **`capabilities`, `tools` estructurado, `memoryConfig`, `guardrails`** y referencia a `LlmProfile`; nueva entidad **`AgentMemory`** para memoria persistente fuera del historial de chat.
> - Nueva entidad **`AgentTemplate`**: groundwork de marketplace (no se construye el marketplace todavía, solo el modelo).
> - Nueva entidad **`LlmProfile`**: configuración de proveedor de IA (Anthropic/OpenAI/Gemini/Mistral/Ollama) por organización o por agente, incluida API key propia del cliente (BYO key).
>
> Notas de diseño que se mantienen:
> - Toda tabla con datos propios de un tenant incluye `organizationId` y un índice sobre esa columna.
> - Los secretos (tokens OAuth, credenciales de conectores, API keys de LLM) se guardan cifrados a nivel de aplicación (`common/utils/encryption.util.ts`), nunca en texto plano — los campos `*Enc` son el resultado cifrado.
> - La columna de embeddings usa el tipo `vector` de la extensión **pgvector**; Prisma no tiene tipo nativo, por lo que se declara con `Unsupported("vector(1536)")` y el índice HNSW se añade vía migración SQL manual.

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

enum PlatformRole {
  USER
  SUPERADMIN
}

enum MembershipRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

enum PlanTier {
  FREE
  PRO
  ENTERPRISE
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  TRIALING
}

enum KnowledgeSourceType {
  FILE_UPLOAD
  WEBSITE
  GOOGLE_DRIVE
  GMAIL
  CRM
  ERP
  DATABASE
  SOCIAL_MEDIA
  API
}

// Reutilizado por KnowledgeSource e Integration (ambos son "conexiones" a sistemas externos)
enum ConnectionStatus {
  PENDING
  SYNCING
  CONNECTED
  ERROR
  DISABLED
}

enum IngestionTriggerType {
  MANUAL
  SCHEDULE
  EVENT
}

enum KnowledgeItemStatus {
  PENDING
  PROCESSING
  INDEXED
  FAILED
  SUPERSEDED // reemplazado por una versión más reciente del mismo KnowledgeItem
}

enum LlmProviderName {
  ANTHROPIC
  OPENAI
  GEMINI
  MISTRAL
  OLLAMA
}

enum AgentTemplateVisibility {
  PRIVATE      // solo la organización que la creó
  ORGANIZATION // compartida entre agentes de la misma organización
  PUBLIC       // catálogo del marketplace (futuro)
}

enum AgentArea {
  SALES
  MARKETING
  SUPPORT
  OPERATIONS
  FINANCE
  HR
  GENERAL
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
  TOOL
}

enum AutomationTriggerType {
  SCHEDULE
  EVENT
  MANUAL
}

enum AutomationStatus {
  ACTIVE
  PAUSED
  ERROR
}

enum RunStatus {
  PENDING
  RUNNING
  SUCCESS
  FAILED
}

enum ReportFormat {
  PDF
  HTML
  MARKDOWN
  JSON
}

enum RecommendationStatus {
  NEW
  ACCEPTED
  DISMISSED
}

enum NotificationType {
  INFO
  SUCCESS
  WARNING
  ERROR
}

enum IntegrationProvider {
  HUBSPOT
  SALESFORCE
  GOOGLE_DRIVE
  SLACK
  SAP
  ZENDESK
  CUSTOM
}

// ─────────────────────────────────────────────────────────────────────────
// Identidad y multi-tenancy
// ─────────────────────────────────────────────────────────────────────────

model User {
  id                String         @id @default(cuid())
  email             String         @unique
  passwordHash      String
  name              String
  avatarUrl         String?
  platformRole      PlatformRole   @default(USER)
  status            String         @default("ACTIVE") // ACTIVE | BANNED
  lastActiveAt      DateTime?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  memberships       Membership[]
  conversations     Conversation[]
  notifications     Notification[]
  auditLogsAsActor  AuditLog[]     @relation("AuditActor")
  createdApiKeys    ApiKey[]
  refreshTokens     RefreshToken[]

  @@index([email])
}

model RefreshToken {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime @default(now())

  @@index([userId])
}

model Organization {
  id              String    @id @default(cuid())
  name            String
  slug            String    @unique
  planTier        PlanTier  @default(FREE)
  settings        Json      @default("{}")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  memberships       Membership[]
  invitations       Invitation[]
  subscription      Subscription?
  knowledgeSources  KnowledgeSource[]
  knowledgeItems    KnowledgeItem[]
  knowledgeCollections KnowledgeCollection[]
  agents            Agent[]
  agentTemplates    AgentTemplate[]        // plantillas publicadas por esta organización (si visibility != PRIVATE)
  llmProfiles       LlmProfile[]
  conversations     Conversation[]
  automations       Automation[]
  reports           Report[]
  integrations      Integration[]
  apiKeys           ApiKey[]
  notifications     Notification[]
  auditLogs         AuditLog[]
  recommendations   Recommendation[]
  usageRecords      UsageRecord[]

  @@index([slug])
}

model Membership {
  id              String         @id @default(cuid())
  userId          String
  organizationId  String
  role            MembershipRole @default(MEMBER)
  invitedById     String?
  joinedAt        DateTime       @default(now())

  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId])
}

model Invitation {
  id              String    @id @default(cuid())
  organizationId  String
  email           String
  role            MembershipRole @default(MEMBER)
  token           String    @unique
  createdById     String
  expiresAt       DateTime
  acceptedAt      DateTime?
  createdAt       DateTime  @default(now())

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([email])
}

model Subscription {
  id                    String             @id @default(cuid())
  organizationId        String             @unique
  planTier              PlanTier
  status                SubscriptionStatus
  paymentProviderCustomerId       String?
  paymentProviderSubscriptionId   String?
  seats                 Int                @default(1)
  currentPeriodEnd      DateTime?
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt

  organization          Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}

// ─────────────────────────────────────────────────────────────────────────
// KNOWLEDGE ENGINE — núcleo del producto
// KnowledgeSource → IngestionJob → KnowledgeItem (versionado, dedup, confianza) → KnowledgeChunk
// ─────────────────────────────────────────────────────────────────────────

model KnowledgeSource {
  id              String            @id @default(cuid())
  organizationId  String
  type            KnowledgeSourceType
  connectorKey    String            // identifica la implementación del conector, p.ej. "google_drive_v1"
  name            String
  configEnc       String            // JSON cifrado: credenciales/config específica del conector
  status          ConnectionStatus  @default(PENDING)
  lastSyncedAt    DateTime?
  lastError       String?
  createdById     String
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  organization    Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  knowledgeItems  KnowledgeItem[]
  ingestionJobs   IngestionJob[]

  @@index([organizationId])
}

// Una fila por cada ejecución de sincronización de una KnowledgeSource — antes solo existía
// como campo de estado en la fuente, sin histórico ni estadísticas por ejecución.
model IngestionJob {
  id                String                @id @default(cuid())
  knowledgeSourceId String
  organizationId    String
  triggerType       IngestionTriggerType  @default(MANUAL)
  status            RunStatus             @default(PENDING)
  stats             Json                  @default("{}") // { itemsFound, itemsCreated, itemsUpdated, itemsSkippedDuplicate, itemsFailed }
  error             String?
  startedAt         DateTime              @default(now())
  finishedAt        DateTime?

  knowledgeSource   KnowledgeSource @relation(fields: [knowledgeSourceId], references: [id], onDelete: Cascade)

  @@index([knowledgeSourceId])
  @@index([organizationId])
}

model KnowledgeCollection {
  id              String          @id @default(cuid())
  organizationId  String
  name            String
  description     String?
  area            AgentArea?
  createdAt       DateTime        @default(now())

  organization    Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  knowledgeItems  KnowledgeItem[]
  agents          Agent[]         @relation("AgentKnowledgeScope")

  @@index([organizationId])
}

model KnowledgeItem {
  id                    String              @id @default(cuid())
  organizationId        String
  knowledgeSourceId     String?
  knowledgeCollectionId String?
  title                 String
  sourceUrl             String?
  mimeType              String?
  sizeBytes             Int?
  contentHash           String              // hash normalizado del contenido — base de la deduplicación
  status                KnowledgeItemStatus @default(PENDING)
  error                 String?
  classification        Json?               // { category, tags } generado por classify-content.use-case
  confidenceScore       Float?              // 0..1, generado por score-confidence.use-case
  version               Int                 @default(1)
  isCanonical           Boolean             @default(true) // false si una versión más nueva la reemplazó
  supersedesId          String?             @unique
  createdAt             DateTime            @default(now())
  indexedAt             DateTime?

  organization          Organization         @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  knowledgeSource        KnowledgeSource?     @relation(fields: [knowledgeSourceId], references: [id], onDelete: SetNull)
  knowledgeCollection    KnowledgeCollection? @relation(fields: [knowledgeCollectionId], references: [id], onDelete: SetNull)
  chunks                 KnowledgeChunk[]
  supersedes             KnowledgeItem?       @relation("KnowledgeItemVersions", fields: [supersedesId], references: [id])
  supersededBy           KnowledgeItem?       @relation("KnowledgeItemVersions")

  @@index([organizationId])
  @@index([knowledgeSourceId])
  @@index([knowledgeCollectionId])
  @@index([organizationId, contentHash]) // lookup rápido de duplicados por organización
}

model KnowledgeChunk {
  id              String   @id @default(cuid())
  knowledgeItemId String
  organizationId  String
  chunkIndex      Int
  content         String
  tokenCount      Int?
  metadata        Json     @default("{}")
  embedding       Unsupported("vector(1536)")
  createdAt       DateTime @default(now())

  knowledgeItem   KnowledgeItem @relation(fields: [knowledgeItemId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([knowledgeItemId])
  // Índice HNSW sobre `embedding` creado vía migración SQL manual:
  // CREATE INDEX ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
}

// ─────────────────────────────────────────────────────────────────────────
// Conversación — superficie de consumo del Knowledge Engine (NO es el núcleo)
// ─────────────────────────────────────────────────────────────────────────

model Conversation {
  id              String    @id @default(cuid())
  organizationId  String
  userId          String
  agentId         String?
  title           String?
  archivedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  agent           Agent?       @relation(fields: [agentId], references: [id], onDelete: SetNull)
  messages        Message[]

  @@index([organizationId])
  @@index([userId])
}

model Message {
  id              String      @id @default(cuid())
  conversationId  String
  role            MessageRole
  content         String
  citations       Json?       // [{ knowledgeItemId, chunkId, snippet }]
  tokenCount      Int?
  createdAt       DateTime    @default(now())

  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId])
}

// ─────────────────────────────────────────────────────────────────────────
// Agentes especializados por área — más que un prompt: capacidades, herramientas,
// memoria, permisos, políticas y alcance de conocimiento explícitos
// ─────────────────────────────────────────────────────────────────────────

model Agent {
  id                String    @id @default(cuid())
  organizationId    String
  templateId        String?   // si se instaló desde un AgentTemplate (groundwork de marketplace)
  name              String
  area              AgentArea @default(GENERAL)
  systemPrompt      String
  llmProfileId      String?   // proveedor/modelo (ver LlmProfile) — null = usa el perfil por defecto de la organización
  temperature       Float?    // override puntual; si es null se usa el de LlmProfile
  capabilities      Json      @default("[]") // habilidades de alto nivel: ["answer_questions", "generate_report", "trigger_automation"]
  tools             Json      @default("[]") // [{ tool: "sql_query", permission: "READ_ONLY" }, { tool: "send_email", permission: "REQUIRES_CONFIRMATION" }]
  memoryConfig      Json      @default("{}") // { strategy: "short_term" | "long_term" | "none", windowSize }
  guardrails        Json      @default("{}") // políticas: límites de acción, reglas de escalado a un humano, temas prohibidos
  isActive          Boolean   @default(true)
  createdById       String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  organization        Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  template             AgentTemplate?        @relation(fields: [templateId], references: [id], onDelete: SetNull)
  llmProfile           LlmProfile?           @relation(fields: [llmProfileId], references: [id], onDelete: SetNull)
  knowledgeCollections KnowledgeCollection[] @relation("AgentKnowledgeScope")
  conversations        Conversation[]
  recommendations      Recommendation[]
  memories             AgentMemory[]

  @@index([organizationId])
}

// Memoria persistente del agente, independiente del historial de una conversación concreta
// (p. ej. "el cliente X prefiere que se le contacte por email", aprendido en una conversación
// y reutilizable en cualquier interacción futura con ese agente).
model AgentMemory {
  id              String    @id @default(cuid())
  agentId         String
  organizationId  String
  conversationId  String?   // null = memoria de largo plazo del agente, no ligada a una conversación
  key             String
  value           Json
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  agent           Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([agentId, organizationId])
}

// Groundwork de marketplace: una plantilla instalable de agente. No se construye el
// marketplace en esta fase, pero el modelo evita una migración disruptiva más adelante.
model AgentTemplate {
  id                    String                   @id @default(cuid())
  publisherOrgId        String?                  // null = plantilla first-party de BusinessBrain
  name                  String
  description           String
  area                  AgentArea
  visibility            AgentTemplateVisibility  @default(PRIVATE)
  defaultSystemPrompt   String
  defaultCapabilities   Json                     @default("[]")
  defaultTools          Json                     @default("[]")
  version               Int                      @default(1)
  createdAt             DateTime                 @default(now())
  updatedAt             DateTime                 @updatedAt

  publisherOrg          Organization? @relation(fields: [publisherOrgId], references: [id], onDelete: SetNull)
  installedAgents       Agent[]

  @@index([publisherOrgId])
  @@index([visibility])
}

// Configuración de proveedor de IA — decouplea el dominio de Anthropic/OpenAI/Gemini/Mistral/Ollama.
// organizationId = null representa un perfil de plataforma disponible como default para cualquier org.
model LlmProfile {
  id              String           @id @default(cuid())
  organizationId  String?
  provider        LlmProviderName
  modelName       String           // p.ej. "claude-sonnet-5", "gpt-4.1", "gemini-2.5-pro", "llama3:70b"
  params          Json             @default("{}") // temperature por defecto, max_tokens, top_p...
  apiKeyEnc       String?          // API key propia del cliente (BYO key), cifrada; null = se usa la key de plataforma
  isDefault       Boolean          @default(false)
  createdAt       DateTime         @default(now())

  organization    Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  agents          Agent[]

  @@index([organizationId])
}

model Recommendation {
  id              String                @id @default(cuid())
  organizationId  String
  agentId         String?
  area            AgentArea?
  title           String
  description     String
  priority        Int                   @default(0)
  status          RecommendationStatus  @default(NEW)
  createdAt       DateTime              @default(now())
  resolvedAt      DateTime?

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  agent           Agent?       @relation(fields: [agentId], references: [id], onDelete: SetNull)

  @@index([organizationId])
}

// ─────────────────────────────────────────────────────────────────────────
// Automatizaciones
// ─────────────────────────────────────────────────────────────────────────

model Automation {
  id              String                @id @default(cuid())
  organizationId  String
  name            String
  triggerType     AutomationTriggerType
  triggerConfig   Json                  // { cron: "0 8 * * 1" } o { event: "document.indexed" }
  actions         Json                  // pasos ordenados: [{ type, config }, ...]
  status          AutomationStatus      @default(ACTIVE)
  lastRunAt       DateTime?
  createdById     String
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  organization    Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  runs            AutomationRun[]

  @@index([organizationId])
}

model AutomationRun {
  id            String    @id @default(cuid())
  automationId  String
  status        RunStatus @default(PENDING)
  startedAt     DateTime  @default(now())
  finishedAt    DateTime?
  logs          Json      @default("[]")
  error         String?

  automation    Automation @relation(fields: [automationId], references: [id], onDelete: Cascade)

  @@index([automationId])
}

// ─────────────────────────────────────────────────────────────────────────
// Informes
// ─────────────────────────────────────────────────────────────────────────

model Report {
  id              String        @id @default(cuid())
  organizationId  String
  name            String
  format          ReportFormat  @default(PDF)
  template        Json          // definición de secciones/queries del informe
  schedule        Json?         // cron opcional para generación periódica
  createdById     String
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  runs            ReportRun[]

  @@index([organizationId])
}

model ReportRun {
  id            String    @id @default(cuid())
  reportId      String
  status        RunStatus @default(PENDING)
  fileUrl       String?
  generatedAt   DateTime  @default(now())
  error         String?

  report        Report @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId])
}

// ─────────────────────────────────────────────────────────────────────────
// Integraciones externas
// ─────────────────────────────────────────────────────────────────────────

model Integration {
  id                String              @id @default(cuid())
  organizationId    String
  provider          IntegrationProvider
  status            ConnectionStatus    @default(PENDING)
  accessTokenEnc    String?
  refreshTokenEnc   String?
  scope             String?
  expiresAt         DateTime?
  connectedById     String
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}

// ─────────────────────────────────────────────────────────────────────────
// Notificaciones, auditoría, acceso API, uso/facturación
// ─────────────────────────────────────────────────────────────────────────

model Notification {
  id              String            @id @default(cuid())
  userId          String
  organizationId  String?
  type            NotificationType  @default(INFO)
  title           String
  body            String?
  readAt          DateTime?
  createdAt       DateTime          @default(now())

  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization    Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([organizationId])
}

model AuditLog {
  id              String    @id @default(cuid())
  organizationId  String?
  actorId         String?
  action          String    // "user.banned", "agent.created", "data_source.connected", ...
  targetType      String?
  targetId        String?
  metadata        Json      @default("{}")
  ipAddress       String?
  createdAt       DateTime  @default(now())

  organization    Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  actor           User?         @relation("AuditActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([actorId])
}

model ApiKey {
  id              String    @id @default(cuid())
  organizationId  String
  name            String
  keyPrefix       String
  hashedKey       String
  createdById     String
  lastUsedAt      DateTime?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy       User         @relation(fields: [createdById], references: [id], onDelete: Cascade)

  @@index([organizationId])
}

model UsageRecord {
  id              String   @id @default(cuid())
  organizationId  String
  metric          String   // "ai_tokens" | "documents_indexed" | "agent_runs" | ...
  value            Int
  periodStart     DateTime
  periodEnd       DateTime

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, metric, periodStart])
}
```

---

## 7. Knowledge Engine — diseño del núcleo del producto

> **Revisión v1.1:** esta sección sustituye al antiguo "pipeline de IA/RAG", que describía la ingesta como una tubería de soporte para el chat. Se reformula alrededor del Knowledge Engine como dominio central, con el chat como uno más de sus consumidores.

### 7.1 Pipeline de conocimiento (`knowledge-engine/application/*.use-case.ts`)

1. **Ingesta** (`ingest-from-source.use-case.ts`): al sincronizar una `KnowledgeSource` (manual, programada o disparada por evento) se crea un `IngestionJob` y el `ConnectorPort` correspondiente (subida de archivo, Google Drive, Gmail, CRM, ERP, scraping web…) extrae el contenido crudo.
2. **Normalización** (`normalize-content.use-case.ts`): el contenido crudo (PDF/Word/HTML/CSV/registro de CRM/email) se convierte a texto plano estructurado, independiente del formato de origen.
3. **Clasificación** (`classify-content.use-case.ts`): el LLM (vía `LlmModule`) etiqueta el contenido con categoría/área de negocio y metadatos (`KnowledgeItem.classification`).
4. **Deduplicación** (`deduplicate-content.use-case.ts`): se calcula `contentHash` y se compara contra `KnowledgeItem`s existentes de la misma organización; un duplicado exacto no crea un ítem nuevo, se descarta y se refleja en `IngestionJob.stats.itemsSkippedDuplicate`.
5. **Versionado** (`version-knowledge-item.use-case.ts`): si el contenido ya existía pero cambió, se crea un nuevo `KnowledgeItem` con `supersedesId` apuntando al anterior, y el anterior pasa a `isCanonical = false` / `status = SUPERSEDED` — nunca se sobrescribe en sitio, para mantener trazabilidad histórica.
6. **Cálculo de confianza** (`score-confidence.use-case.ts`): heurística + LLM asignan `confidenceScore` (p. ej. una política de RR. HH. firmada pesa más que un borrador de email).
7. **Embeddings** (`knowledge-engine/infrastructure/embedding/` → `LlmModule`): el texto se divide en fragmentos (~500-800 tokens con solape) y cada uno se guarda como `KnowledgeChunk` con su vector.
8. **Recuperación** (`retrieve-context.use-case.ts`): **punto único** de búsqueda semántica — genera el embedding de una consulta y busca por similitud coseno (`pgvector`), filtrando siempre por `organizationId` y, si aplica, por `KnowledgeCollection`/`confidenceScore` mínimo. Es la única puerta de entrada al conocimiento indexado; ningún módulo consulta `KnowledgeChunk` directamente.

### 7.2 Superficies de consumo (pares, ninguna privilegiada)

Todas acceden al conocimiento por el mismo `retrieve-context.use-case` y, **a partir de la Fase 4**, a la comprensión por el mismo `RetrieveInsights` del Understanding Engine. Ninguna reconstruye razonamiento por su cuenta a partir de fragmentos recuperados: si necesita comprensión, la pide.

- **Chat** (`ConversationsModule`): construye el prompt (`prompt-builder.service.ts`) con system prompt del `Agent`, historial de la `Conversation` y los `KnowledgeChunk` recuperados como contexto citado; la respuesta hace streaming vía SSE/WebSocket (`messages.gateway.ts`) y se persiste como `Message` con `citations` (`knowledgeItemId`, `chunkId`), dando trazabilidad de "por qué la IA dijo esto".
- **Agentes** (`AgentsModule` → `run-agent.use-case.ts`): recuperan contexto acotado a su `knowledgeCollections` (alcance de conocimiento del agente), no a toda la organización.
- **Automatizaciones** (`AutomationsModule`): un job programado puede pedir "genera un resumen semanal del área de ventas a partir del conocimiento indexado este mes".
- **Recomendaciones** (`RecommendationsModule`): igual que automatizaciones, pero persistido como `Recommendation`.
- **Informes** (`ReportsModule`) y **API pública** (`ApiKeysModule`): mismo patrón.

### 7.3 Capa de proveedor LLM desacoplada (`LlmModule`)

`ProviderRegistry` resuelve, para cada llamada, qué `LlmProvider` usar: primero el `LlmProfile` del `Agent` (si lo tiene), si no el de la `Organization` marcado `isDefault`, si no un perfil de plataforma. Esto permite a un cliente usar Claude para su agente de atención al cliente y Ollama on-prem para el de RR. HH. (datos sensibles que no deben salir de su infraestructura), sin tocar código. El mismo mecanismo aplica a embeddings (`EmbeddingProviderPort`), que puede ser un proveedor distinto al conversacional.

### 7.4 Agentes como orquestadores, no como prompts

`run-agent.use-case.ts` combina, en este orden: (1) `knowledgeCollections` del agente → alcance de qué puede recuperar; (2) `tools` con su permiso individual (`READ_ONLY` / `REQUIRES_CONFIRMATION` / `AUTONOMOUS`); (3) `memoryConfig` → qué recuerda entre conversaciones (`AgentMemory`); (4) `guardrails` → límites y reglas de escalado a un humano, evaluados por `enforce-agent-policy.use-case.ts` antes de ejecutar cualquier tool con efectos.

### 7.5 Marketplace de agentes (futuro, no implementado ahora)

`AgentTemplate` permite catalogar plantillas (`visibility: PRIVATE/ORGANIZATION/PUBLIC`) e instalarlas como `Agent` (`install-agent-template.use-case.ts`, `Agent.templateId`). No se construye tienda, pagos ni revisión de plantillas de terceros en esta fase — solo se garantiza que el modelo no requerirá migración cuando se aborde.

### 7.6 Mitigación de riesgos específicos de conocimiento multi-tenant

- **Fuga de datos entre tenants**: toda query vectorial pasa obligatoriamente por `retrieve-context.use-case` con `organizationId`; se verifica con tests de integración dedicados. Ningún consumidor tiene un camino alternativo de acceso a `KnowledgeChunk`.
- **Inyección de prompt vía contenido ingerido**: el system prompt de cada `Agent` instruye explícitamente a tratar el contenido recuperado como datos, no como instrucciones; las `tools` con permiso `REQUIRES_CONFIRMATION` (enviar email, ejecutar automatización) no se ejecutan sin confirmación humana o rol elevado, validado por `enforce-agent-policy.use-case.ts`.
- **Secretos de conectores y de proveedores LLM**: nunca se envían al LLM; `configEnc` (conectores) y `apiKeyEnc` (LLM profiles con BYO key) solo se descifran server-side dentro de `knowledge-engine/infrastructure` e `llm/infrastructure` respectivamente, y una key propia de un cliente nunca se comparte entre organizaciones.

---

## 8. Frontend (React + TypeScript)

### 8.1 Estructura de carpetas

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes.tsx
│   │
│   ├── api/
│   │   ├── client.ts                 # cliente HTTP base (fetch/axios + interceptor de auth)
│   │   ├── auth.api.ts
│   │   ├── organizations.api.ts
│   │   ├── knowledgeSources.api.ts
│   │   ├── knowledgeItems.api.ts
│   │   ├── conversations.api.ts
│   │   ├── agents.api.ts
│   │   ├── automations.api.ts
│   │   ├── reports.api.ts
│   │   ├── integrations.api.ts
│   │   └── admin.api.ts
│   │
│   ├── context/
│   │   ├── AuthContext.tsx            # se conserva el patrón de Drop
│   │   ├── OrganizationContext.tsx    # sustituye/extiende a AppContext.jsx (org activa, plan, settings)
│   │   └── NotificationContext.tsx
│   │
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useOrganization.ts
│   │   ├── useConversations.ts
│   │   ├── useAgents.ts
│   │   ├── useKnowledgeSources.ts
│   │   └── useChatStream.ts           # consumo de SSE/WebSocket de /conversations/:id/messages
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx             # conservado de Drop, contenido adaptado
│   │   │   ├── Sidebar.tsx            # nuevo: navegación entre Chat/Knowledge/Agents/...
│   │   │   └── Footer.tsx             # conservado de Drop
│   │   ├── shared/
│   │   │   ├── Modal.tsx
│   │   │   ├── Notification.tsx       # conservado de Drop
│   │   │   ├── PlanBadge.tsx          # conservado de Drop (tier FREE/PRO/ENTERPRISE)
│   │   │   ├── DataTable.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   └── FileUploadDropzone.tsx
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── ChatBubble.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   └── CitationPopover.tsx    # muestra fuente/documento citado
│   │   ├── knowledge/
│   │   │   ├── KnowledgeSourceCard.tsx
│   │   │   ├── KnowledgeItemRow.tsx      # muestra versión, confianza y estado
│   │   │   └── KnowledgeCollectionPicker.tsx
│   │   ├── agents/
│   │   │   ├── AgentCard.tsx
│   │   │   ├── AgentEditorForm.tsx        # incluye tools/permisos, memoria, guardrails, alcance de conocimiento
│   │   │   └── AgentTemplateCard.tsx      # catálogo de plantillas (groundwork de marketplace)
│   │   ├── automations/
│   │   │   └── AutomationCard.tsx
│   │   ├── reports/
│   │   │   └── ReportCard.tsx
│   │   └── integrations/
│   │       └── IntegrationCard.tsx
│   │
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   └── AcceptInvitation.tsx
│   │   ├── onboarding/
│   │   │   ├── CreateOrganization.tsx
│   │   │   └── ConnectFirstKnowledgeSource.tsx
│   │   ├── Dashboard.tsx              # KPIs, actividad reciente, recomendaciones destacadas
│   │   ├── chat/
│   │   │   └── Chat.tsx               # lista de conversaciones + ventana de chat (núcleo del producto)
│   │   ├── knowledge/
│   │   │   ├── KnowledgeSources.tsx
│   │   │   ├── KnowledgeSourceDetail.tsx  # incluye histórico de IngestionJob
│   │   │   └── KnowledgeCollections.tsx
│   │   ├── agents/
│   │   │   ├── Agents.tsx
│   │   │   ├── AgentEditor.tsx
│   │   │   └── AgentTemplateGallery.tsx   # UI ya enrutada; contenido real llega con el marketplace (fase futura)
│   │   ├── automations/
│   │   │   ├── Automations.tsx
│   │   │   └── AutomationEditor.tsx
│   │   ├── reports/
│   │   │   ├── Reports.tsx
│   │   │   └── ReportViewer.tsx
│   │   ├── integrations/
│   │   │   └── Integrations.tsx
│   │   ├── settings/
│   │   │   ├── OrganizationSettings.tsx
│   │   │   ├── Members.tsx
│   │   │   ├── Billing.tsx
│   │   │   ├── ApiKeys.tsx
│   │   │   └── Profile.tsx
│   │   ├── admin/
│   │   │   └── Admin.tsx              # evolución directa de pages/Admin.jsx (superadmin)
│   │   └── marketing/                 # landing pública, layout conservado de Drop
│   │       ├── Home.tsx               # reutiliza Hero/Features/HowItWorks/Stats/CTA, copy nuevo
│   │       └── Pricing.tsx
│   │
│   ├── i18n/                          # conservado de Drop, nuevos namespaces de contenido
│   └── index.css                      # Tailwind conservado
│
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

### 8.2 Gestión de estado

- **Estado de servidor**: TanStack Query para todo fetch/mutación (sustituye el `fetch` manual de `AppContext.jsx` actual), con invalidación por organización activa.
- **Estado de sesión/tenant**: `AuthContext` (usuario + token) y `OrganizationContext` (organización activa, rol del usuario en ella, plan) — cualquier cambio de organización activa invalida la caché de TanStack Query.
- **Streaming de chat**: hook dedicado (`useChatStream`) sobre WebSocket/SSE, no sobre TanStack Query.

### 8.3 Páginas eliminadas vs. nuevas (resumen)

| Drop (eliminado) | BusinessBrain (nuevo) |
|---|---|
| `Feed.jsx`, `FeedCard.jsx` | `chat/Chat.tsx` (el "feed" pasa a ser el hilo de conversación con la IA) |
| `Playlists.jsx`, `PlaylistCard.jsx`, `CreatePlaylistModal.jsx` | `knowledge/KnowledgeCollections.tsx` (agrupaciones de conocimiento) |
| `Discover.jsx`, `Search.jsx` | `knowledge/KnowledgeSources.tsx` + búsqueda semántica integrada en el chat |
| `Trending.jsx` | `Dashboard.tsx` (KPIs y recomendaciones) |
| — (no existía) | `agents/*` (incl. `AgentTemplateGallery.tsx`), `automations/*`, `reports/*`, `integrations/*` (dominio nuevo) |
| `pages/Admin.jsx` | `admin/Admin.tsx` (conservado y ampliado a multi-tenant) |

---

## 9. Seguridad y cumplimiento

- **Aislamiento de tenant** reforzado en dos capas: filtro obligatorio por `organizationId` en `PrismaService` (capa de aplicación) + políticas **RLS** de PostgreSQL como defensa en profundidad (fase de hardening).
- **Cifrado de secretos**: tokens OAuth, credenciales de conectores (`KnowledgeSource.configEnc`) y API keys propias de LLM (`LlmProfile.apiKeyEnc`) cifrados en reposo (AES-256-GCM a nivel de aplicación o KMS gestionado); una API key BYO de un cliente nunca se comparte entre organizaciones ni se registra en logs/auditoría.
- **RBAC de tres niveles** *(v1.1)*: `PlatformRole` (plataforma), `MembershipRole` (organización) y permisos/guardrails por `Agent` (§7.4) evaluados en cada request vía guards y por `enforce-agent-policy.use-case.ts`; ningún endpoint de dominio queda sin guard salvo los explícitamente públicos (`/health`, callbacks OAuth).
- **Auditoría**: `AuditInterceptor` registra automáticamente acciones sensibles (cambios de rol, borrado de datos, conexión/desconexión de integraciones, acciones de superadmin).
- **Límites por plan**: `PlanLimitGuard` valida cuotas (nº de documentos indexados, tokens de IA/mes, nº de agentes) contra `UsageRecord` antes de ejecutar operaciones costosas.
- **Validación de entrada**: DTOs con `class-validator`/`zod` en todos los controllers; sanitización de archivos subidos (tipo MIME, tamaño máximo, escaneo antivirus si aplica).
- **Prompt injection**: ver §7.1.

---

## 10. Roadmap de migración por fases

| Fase | Estado | Contenido | Resultado esperado |
|---|---|---|---|
| **0** | ✅ Completada | Congelar desarrollo de Drop (ya decidido) | Punto de partida limpio |
| **1** | ✅ Completada | Monorepo (`apps/`, `packages/database`, `packages/config`) + NestJS 11 + Prisma (schema completo, 24 modelos, migrado con pgvector/HNSW) + Postgres/Redis vía Docker Compose; `AuthModule`, `OrganizationsModule`, `AdminModule`; **`LlmModule`** con `AnthropicProvider` + `OpenAiProvider` (segundo proveedor real, no Ollama) tras la abstracción `LlmProviderPort`/`ProviderRegistry` | **Cumplido**: registro/login multi-tenant, superadmin operativo, RBAC de organización verificado (aislamiento entre tenants probado en vivo), abstracción de LLM validada con 2 proveedores reales por configuración. Detalle completo en el informe de cierre de Fase 1. |
| **2** | ✅ Completada | `KnowledgeEngineModule` completo: `KnowledgeSource` + `IngestionJob` + normalización + clasificación + dedup (niveles 1-2) + linaje + versionado + confianza viva + canonicalización + `KnowledgeChunk`/pgvector + Retriever | **Cumplido**: ingesta end-to-end con historial de versiones, sin duplicados e idempotente bajo concurrencia. Cierra en `65d924d` (subfase 2.7, retrieval). |
| **3** | ✅ Completada | **`UnderstandingEngineModule`** — [`docs/UNDERSTANDING_ENGINE_DESIGN.md`](./UNDERSTANDING_ENGINE_DESIGN.md) (🧊 congelado v1.0): `AnalysisRun` + `Insight` (identidad de sujeto, cierre transitivo de evidencia, proyecciones vivas de alcance y frescura) + `BusinessObjective` y gate de riesgo/oportunidad + razonamiento generativo + confianza compuesta + curación humana + `RetrieveInsights` | **Cumplido**: comprensión derivada, justificada y trazable. Cierra en `6548e41` (subfases 3.3-3.6), con tests de integración versionados en `275e336`. Sin consumidores conectados todavía — se conectan en la Fase 6.1. |
| **4** | ✅ Completada | `ConversationsModule` como primer consumidor del Understanding Engine (`RetrieveInsights`) y del Retriever; respuesta en streaming (SSE) | **Cumplido**: chat contextualizado con citas, apoyado en comprensión y no solo en recuperación, sin lógica de RAG propia. Cierra en `cbbb99b` (subfase 4.2). |
| **5** | ✅ Completada | `AgentsModule` (definición, gate de políticas fail-closed, alcance de conocimiento, memoria privada por usuario, ejecución de herramientas de solo lectura, catálogo `AgentTemplate` e instalación) + `RecommendationsModule` | **Cumplido**: agentes por área operativos y catálogo de plantillas instalable. Cierra en `c9ae8c5` (5.8), con auditoría adversarial en `a0fbaa1` y endurecimiento 5.9 en `60c3ef2`…`956ff05` (memoria en el turno, tools ejecutadas de verdad, contador de servidor, primera suite E2E HTTP real). |
| **5.5** | ✅ Completada | **Endurecimiento y alcanzabilidad** (no estaba en el plan original; se inserta tras la auditoría de cierre de la Fase 5): 6.1 el Understanding Engine pasa a ser alcanzable por HTTP · 6.2 `AuditService` como escritor único · 6.3 alcance de conocimiento obligatorio por construcción · 6.4 paginación en SQL, fin del N+1 y errores tipados | **Cumplido**: la comprensión deja de ser código que nadie ejecutaba. `5a0ccb7`, `bc24ee4`, `cd47c5c`, `4650bf5`. |
| **5.6** | ✅ Completada | **Memoria de la creencia** (evolución no prevista en el plan original): versionado de `Insight` por supersesión en lugar de sobrescritura en sitio, trayectoria de confianza con atribución exacta de evidencia, historia por HTTP · 7.1 la curación humana sobrevive al versionado como proyección de lectura · 7.2 vocabulario canónico de identidad de sujeto (referente + aspecto) | **Cumplido**: el sistema puede responder "qué creíamos antes, qué creemos ahora y qué evidencia lo movió". `1a29bb7`, `0bd1cd7`, `66b00c7`. |
| **6** | ✅ Completada | `AutomationsModule` (`SchedulerPort` implementado por primera vez, catálogo cerrado de acciones, reclamación de vencidas sin cerrojo aplicativo) + `ReportsModule` (catálogo cerrado de secciones, composición exclusiva por `RetrieveInsights`/`RetrieveContext`, PDF entregado bajo demanda sin almacenar) | **Cumplido**: el sistema comprende sin que nadie se lo pida y entrega informes exportables. `6ab9754`, `5da725e`. |
| **6.5** | ✅ Completada | **Interfaz web mínima** (`apps/web`, React + TS + Vite + Tailwind): login, panel, conocimiento, comprensión, historia de la creencia, curación, objetivos, análisis, automatizaciones, informes y configuración. Se añaden además `GET/POST /knowledge-collections` y la relación `KnowledgeSource → KnowledgeCollection`, sin las cuales lo ingerido nacía fuera de toda colección y era invisible para todo el mundo | **Cumplido**: BusinessBrain deja de ser una API. `cde137e`. |
| **7** | 🔄 En curso | `IntegrationsModule`. **Primera integración: página web sin OAuth** — conector `web_page_v1`, adquisición `PULL`, guard anti-SSRF sobre la IP resuelta y cada salto de redirección, y acción de automatización `SYNC_KNOWLEDGE_SOURCE`. Pendientes: Google Drive y Gmail (OAuth), y el resto de conectores | Conectores externos reales, más allá de subida manual |
| **8** | ⬜ Pendiente | `BillingModule` + `ApiKeysModule` + límites de plan | Monetización y acceso programático |
| **9** | ⬜ Pendiente | Frontend completo contra la nueva API (TypeScript) | UI de producto reemplaza landing/demo actual |
| **10** | ⬜ Pendiente | Hardening: RLS, rate limiting, observabilidad, pruebas de carga, auditoría de aislamiento entre tenants sobre `retrieve-context.use-case` y sobre `RetrieveInsights` | Listo para producción multi-cliente |

> **Estado real a 2026-08-16 (`5da725e`).** Las fases 0-6 están cerradas y verificadas. Dos bloques de trabajo NO previstos en el plan original se insertaron por decisión explícita tras auditar el cierre de la Fase 5, y se recogen arriba como **5.5** y **5.6** para no reescribir la numeración de las fases pendientes:
>
> - **5.5 (endurecimiento y alcanzabilidad).** La auditoría de cierre de la Fase 5 encontró que el Understanding Engine **no tenía ningún consumidor**: ni controlador ni planificador. Cero objetivos de negocio y cero recomendaciones creados en toda la vida del proyecto, confirmado contra la base de datos. Se corrigió antes de seguir construyendo encima.
> - **5.6 (memoria de la creencia).** Un reanálisis escribía la confianza nueva ENCIMA de la anterior, contradiciendo dos veces el diseño congelado (§121, §344: un `Insight` nunca se sobrescribe en sitio). `supersedesInsightId` y el estado `SUPERADO` llevaban fases en el esquema sin que los escribiera nadie.
>
> Ambos casos son la misma clase de hallazgo, y conviene tenerla presente: **el esquema va por delante del comportamiento**. Un modelo existe, parece implementado, y nada lo escribe.
>
> **Cambio de alcance de la Fase 3 (2026-07-28).** La Fase 3 se definía originalmente como "`ConversationsModule` como primer consumidor de `retrieve-context.use-case`" (chat plano, sin razonamiento). Se sustituye por el **Understanding Engine**, y el chat se pospone a la Fase 4, donde se construye sobre la comprensión y nunca directamente sobre el Retriever. Las fases posteriores se desplazan una posición. Esta decisión responde al principio de producto fundacional: **BusinessBrain no existe para responder preguntas, existe para comprender una empresa**; el chat es una interfaz de esa comprensión, no el núcleo del sistema (§3.2, "Filosofía").

### Deuda de seguridad priorizada

| Deuda | Riesgo | Estado |
|---|---|---|
| ~~El token de refresco vive en `localStorage`~~ | ~~Alto~~ | ✅ **Cerrada**. Viaja en cookie `HttpOnly` + `SameSite=Strict`, con doble envío CSRF en las dos rutas autenticadas por cookie. `/auth/refresh` y `/auth/logout` ya NO aceptan el token en el cuerpo: dejar esa puerta abierta habría anulado el cambio |
| `ALLOW_LOOPBACK_FETCH` desactiva la comprobación de destino del conector web para poder probarlo contra un servidor local. Está condicionada además a `NODE_ENV !== 'production'`, así que una variable mal puesta en un despliegue real no abre la red interna | Bajo — doble condición | 🟡 Aceptada conscientemente |
| Sin rate limiting, sin RLS y sin revocación de access tokens ya emitidos (ventana máx. 15 min) | Medio | 🟡 Fase 10 (hardening) |

**Gaps conocidos de la Fase 1** (no bloquean el cierre, quedan explícitamente para más adelante): ~~sin test e2e automatizado con Supertest~~ —resuelto en 5.9.4 (`243990e`), hoy hay tres tramos de verificación: unitarios, integración contra Postgres real y E2E HTTP sobre el `AppModule` completo—; sin rate limiting; sin revocación de access tokens ya emitidos (ventana máx. 15 min); `OrganizationsModule` no escribe todavía en `AuditLog`. Ver el informe de cierre de Fase 1 para el detalle completo.

---

## 11. Preguntas abiertas (a decidir antes de implementar)

1. **Proveedor de pagos**: ¿Stripe u otro? (afecta `BillingModule`).
2. **Almacenamiento de archivos**: ¿S3, Cloudflare R2, o gestor propio? (afecta `KnowledgeEngineModule`/`KnowledgeItem`).
3. **Conectores prioritarios de integración** (fase 6): ¿qué CRM/ERP concretos se soportan primero (HubSpot, Salesforce, SAP, otros)?
4. **Modelo de embeddings**: ¿mismo proveedor que el LLM conversacional o uno especializado (p. ej. Voyage AI) para mejor calidad de recuperación?
5. **Residencia de datos**: ¿hay requisitos de región/UE para clientes empresariales que condicionen el hosting de Postgres/almacenamiento?
6. ~~**Proveedores LLM a validar primero**~~ — ✅ **Resuelta en la Fase 1**: OpenAI, no Ollama (validar contra un segundo proveedor SaaS real). Implementado en `LlmModule` (`AnthropicProvider` + `OpenAiProvider` tras `LlmProviderPort`).
7. **Alcance del marketplace de agentes** *(v1.1)*: `AgentTemplate` ya soporta `publisherOrgId`, ¿el catálogo inicial será solo first-party (BusinessBrain) o se abre a que otras organizaciones publiquen plantillas desde el principio? Afecta si se necesita revisión/moderación de contenido antes de fase 4.
8. ~~**Grado de adopción del layering híbrido**~~ — ✅ **Resuelta en la Fase 1**: capas explícitas en `llm/` (domain/application/infrastructure); el resto de módulos de esta fase (`auth`, `organizations`, `admin`) usan estructura plana, sin objeción del usuario al aprobar el alcance.
