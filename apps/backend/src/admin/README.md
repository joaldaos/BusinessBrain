# AdminModule

## Responsabilidad
Panel de superadministración **de plataforma** (no de una organización concreta): estadísticas globales, listado de organizaciones/usuarios, ban de usuarios y cambio de plan de una organización. Evolución directa de `server/routes/admin.js` de Drop, adaptada a multi-tenant.

## Dependencias
`PrismaService`, `SuperAdminGuard` (de `common/`).

## Flujo de funcionamiento
Todas las rutas están protegidas por `SuperAdminGuard` a nivel de controller (`@UseGuards(SuperAdminGuard)` en la clase, no por método) — no existe una ruta de `AdminModule` accesible sin `platformRole: SUPERADMIN`. Las acciones que cambian estado (`toggleUserBan`, `changeOrganizationPlan`) escriben una fila en `AuditLog` con el actor, la acción y (para el cambio de plan) el valor anterior y el nuevo en `metadata`.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/admin/stats` | Totales de usuarios/organizaciones, baneados, organizaciones por plan |
| GET | `/admin/organizations?page=` | Listado paginado (20/página) |
| GET | `/admin/users?page=` | Listado paginado (20/página) |
| POST | `/admin/users/:id/ban` | Alterna baneado/activo (toggle, sin body) |
| POST | `/admin/organizations/:id/plan` | Cambia `planTier` (`{ planTier }`) |

## Decisiones de diseño
- **Guard a nivel de controller, no por endpoint**: reduce a cero el riesgo de olvidar el guard en una ruta nueva de este módulo — cualquier endpoint que se añada aquí hereda la restricción automáticamente.
- **Auditoría mínima inline, no un `AuditInterceptor` global todavía**: el documento de arquitectura (§4) prevé un interceptor transversal de auditoría, pero con un solo módulo escribiendo en `AuditLog` construir el interceptor genérico sería abstraer antes de tener el segundo caso de uso real. Se revisará cuando `OrganizationsModule` (cambios de rol) u otro módulo necesite el mismo patrón.
- **`toggleUserBan` es un toggle, no `ban`/`unban` separados**: simplifica el endpoint; el cuerpo de la respuesta (`{ id, status }`) deja claro el resultado.

## Ampliaciones futuras
- `GET /admin/audit-logs` para consultar el histórico (hoy los `AuditLog` se escriben pero no hay endpoint de lectura — no era necesario para el alcance de la Fase 1).
- Filtros de búsqueda en los listados (por email, por plan, por estado).
- `AuditInterceptor` global cuando 2-3 módulos más repitan el patrón de "escribir un AuditLog tras una acción sensible".
