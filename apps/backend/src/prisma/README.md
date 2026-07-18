# PrismaModule

## Responsabilidad
Exponer `PrismaService` (cliente Prisma con ciclo de vida NestJS) a toda la aplicación, sin duplicar conexiones a PostgreSQL.

## Dependencias
`@businessbrain/database` (cliente Prisma generado y schema — ver su propio README para el porqué de vivir en un paquete de workspace separado).

## Flujo de funcionamiento
`PrismaService` extiende `PrismaClient` y conecta en `onModuleInit`, desconecta en `onModuleDestroy`. El módulo se declara `@Global()` para que cualquier módulo de dominio pueda inyectar `PrismaService` sin importar `PrismaModule` explícitamente.

## Endpoints
No aplica.

## Decisiones de diseño
- **Sin lógica de scoping por organización aquí todavía.** Cada módulo filtra explícitamente por `organizationId` en sus propias queries (p. ej. `OrganizationsService`, `AdminService`). Añadir aquí un middleware de Prisma que inyecte automáticamente el filtro es una optimización razonable, pero prematura con un solo módulo de dominio construido — se revisará cuando haya 3-4 módulos repitiendo el mismo patrón de filtrado.
- Row-Level Security de PostgreSQL como segunda capa de aislamiento está en el roadmap (fase 9, hardening), no en esta fase.

## Ampliaciones futuras
- Middleware/extensión de Prisma para scoping automático por `organizationId` si el patrón se repite mucho.
- Métricas de queries lentas (Prisma `$on('query')`) cuando haya tráfico real que perfilar.
