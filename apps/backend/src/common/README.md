# common/

## Responsabilidad
Infraestructura transversal compartida por todos los módulos: guards de autenticación/autorización, decoradores, filtro global de excepciones, interceptor de forma de respuesta, y utilidades (cifrado). No contiene lógica de dominio de ningún módulo.

## Dependencias
`@nestjs/passport`, `@nestjs/config`, `@businessbrain/database` (tipos de enums para roles), `PrismaService` (usado por `OrgRoleGuard`).

## Flujo de funcionamiento
- **`JwtAuthGuard`** (global, ver `app.module.ts`): exige un access token válido en toda ruta salvo las marcadas `@Public()`.
- **`OrgRoleGuard`** (aplicado por módulo, no global): resuelve la organización activa desde `:id`/`:organizationId` de la ruta o el header `x-org-id`, verifica membresía y adjunta `req.organization`. Si el endpoint declara `@OrgRoles(...)`, exige un rol mínimo.
- **`SuperAdminGuard`** (aplicado solo en `AdminModule`): exige `platformRole === SUPERADMIN`.
- **`AllExceptionsFilter`** (global): normaliza cualquier error a `{ statusCode, error, timestamp }` y evita filtrar stack traces.
- **`TransformResponseInterceptor`** (global): envuelve toda respuesta 2xx en `{ data: ... }`.
- **`EncryptionService`** (`common/utils/encryption.util.ts`): AES-256-GCM listo para cifrar secretos en reposo (`KnowledgeSource.configEnc`, `LlmProfile.apiKeyEnc`, tokens de `Integration`). **Sin consumidores todavía en la Fase 1** — no está registrado como provider en ningún módulo; se añadirá al módulo correspondiente (`knowledge-engine`, `integrations`) en cuanto exista el primer caso de uso real, en vez de mantener un provider global sin nada que lo inyecte.

## Endpoints
No aplica — es infraestructura, no expone rutas propias.

## Decisiones de diseño
- **RBAC de tres capas, dos guards activos en esta fase** (`JwtAuthGuard` + `OrgRoleGuard`/`SuperAdminGuard`); la tercera capa (permisos/guardrails por `Agent`) se añade en la Fase 4, cuando exista `AgentsModule` — no se construye aquí en vacío.
- **`OrgRoleGuard` no es global**: a diferencia de `JwtAuthGuard`, no todas las rutas tienen una organización en el path (p. ej. `/auth/me`, `/admin/*`), así que se aplica explícitamente en los controllers que sí la necesitan (`OrganizationsModule`).
- **Jerarquía de roles de membresía** (`OWNER > ADMIN > MEMBER > VIEWER`) vive solo dentro de `OrgRoleGuard` como un ranking numérico interno — no se modela en la base de datos porque es una regla de autorización, no un dato.

## Ampliaciones futuras
- Cuarto guard de permisos por agente (`enforce-agent-policy`) cuando llegue `AgentsModule` (Fase 4).
- `AuditInterceptor` transversal (mencionado en el documento de arquitectura, §4) — no implementado todavía. En esta fase solo `AdminModule` escribe en `AuditLog` (ban, cambio de plan), de forma manual dentro de su propio servicio; `OrganizationsModule` **no** audita todavía sus acciones sensibles (invitaciones, altas de miembro) — queda como gap conocido hasta que el patrón se repita lo suficiente para justificar el interceptor genérico.
- Registrar `EncryptionService` como provider en el primer módulo que realmente la necesite (probablemente `knowledge-engine` en la Fase 2).
