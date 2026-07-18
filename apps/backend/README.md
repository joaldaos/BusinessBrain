# BusinessBrain API (backend)

Implementación NestJS de la arquitectura definida en [`docs/BUSINESSBRAIN_MIGRATION_PLAN.md`](../../docs/BUSINESSBRAIN_MIGRATION_PLAN.md) (documento congelado — cualquier cambio de dominio/modelo pasa por ahí primero, no por este código).

Cada módulo de dominio tiene su propio `README.md` junto a su código (responsabilidad, endpoints, decisiones de diseño, ampliaciones futuras): [`src/prisma`](src/prisma/README.md), [`src/common`](src/common/README.md), [`src/auth`](src/auth/README.md), [`src/organizations`](src/organizations/README.md), [`src/admin`](src/admin/README.md), [`src/llm`](src/llm/README.md), [`src/health`](src/health/README.md).

## Requisitos

- Node.js 24+
- Docker (para Postgres+pgvector y Redis vía `docker-compose.yml` en la raíz del repo)

## Arranque en local

Desde la **raíz del repo** (monorepo con workspaces):

```bash
npm install
docker compose up -d postgres redis

# Generar cliente Prisma y aplicar migraciones (una sola vez, o tras cambios de schema)
npm run generate --workspace=@businessbrain/database
npm run migrate:deploy --workspace=@businessbrain/database
npm run seed --workspace=@businessbrain/database

cp apps/backend/.env.example apps/backend/.env   # y rellenar ENCRYPTION_KEY como mínimo
npm run start:dev --workspace=@businessbrain/backend
```

`GET http://localhost:3000/health` debe responder `200` si Postgres está accesible.

## Tests

```bash
npm run test --workspace=@businessbrain/backend
```

## Estado del roadmap

**Fase 1 completada** (§10 del documento de arquitectura): scaffold NestJS + Prisma, `AuthModule`, `OrganizationsModule`, `AdminModule`, `LlmModule` (Anthropic + OpenAI validando la abstracción de proveedor). Verificado end-to-end contra Postgres real (no solo tests con mocks): registro/login, rotación de refresh token, aislamiento multi-tenant, invitaciones, panel de superadmin.

**Fase 2 (siguiente)**: `KnowledgeEngineModule`. Los módulos de `agents`, `conversations`, `automations`, `reports`, `integrations` llegan en fases posteriores — sus tablas ya existen en el schema de Prisma, pero no tienen módulo NestJS todavía.
