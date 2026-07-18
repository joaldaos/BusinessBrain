# @businessbrain/database

## Responsabilidad
Fuente de verdad física del modelo de datos: schema de Prisma, migraciones y seed. Es el único paquete del monorepo que conoce el esquema de PostgreSQL; todo lo demás accede a los datos a través del cliente Prisma que este paquete genera y exporta.

## Dependencias
- `@prisma/client` / `prisma` (ORM y generador de cliente).
- PostgreSQL 16+ con la extensión `pgvector` habilitada (ver migración `0_init`).
- `bcryptjs` únicamente para el script de seed (hash del password del superadmin).
- `@businessbrain/config` (tsconfig base).

## Flujo de funcionamiento
1. `schema.prisma` define modelos/enums — **copia exacta** de `docs/BUSINESSBRAIN_MIGRATION_PLAN.md §6**. No se edita aquí de forma independiente: cualquier cambio de modelo pasa primero por ese documento (arquitectura congelada).
2. `npm run generate` (workspace `@businessbrain/database`) genera el cliente TypeScript en `node_modules/@prisma/client`.
3. `npm run migrate:dev` / `migrate:deploy` aplican las migraciones SQL versionadas en `prisma/migrations/`.
4. `npm run seed` ejecuta `prisma/seed.ts` (usuario superadmin de plataforma + organización de demostración).
5. Cualquier app (`apps/backend`, futuros workers) importa `PrismaClient` **solo** desde `@businessbrain/database` (`src/index.ts`), nunca desde `@prisma/client` directamente — así, si en el futuro se necesita centralizar aquí un middleware de scoping por `organizationId`, no hay que tocar cada consumidor.

## Endpoints
No aplica — es una librería, no un servicio HTTP.

## Decisiones de diseño
- **Paquete de workspace independiente, no carpeta dentro de `apps/backend`**: el roadmap aprobado prevé extraer workers de ingesta a procesos separados más adelante; si el schema viviera dentro de `apps/backend`, ese día habría que migrar el cliente Prisma a un paquete compartido. Se evita esa migración haciéndolo así desde la Fase 1.
- La extensión `pgvector` y el índice HNSW sobre `KnowledgeChunk.embedding` no se pueden expresar en `schema.prisma` (Prisma no tiene tipo `vector` nativo) — se gestionan con SQL manual en la migración inicial (ver `prisma/migrations/`).
- El seed crea un **superadmin de plataforma** (`platformRole: SUPERADMIN`) y una organización de demo con membership `OWNER`, replicando el propósito de `server/store/seed.js` de Drop pero en el modelo multi-tenant nuevo.

## Ampliaciones futuras
- Row-Level Security (RLS) de PostgreSQL como segunda capa de aislamiento multi-tenant (fase de hardening, §10 fase 9 del documento).
- Extracción de un `KnowledgeRepository`/`AgentRepository` tipado si el acceso directo al `PrismaClient` desde cada módulo empieza a repetir demasiada lógica de consulta.
