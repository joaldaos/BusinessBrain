# OrganizationsModule

## Responsabilidad
Gestión de organizaciones (tenants), membresías e invitaciones. Es el punto donde un `User` (creado por `AuthModule`) pasa a pertenecer a una organización con un rol concreto.

## Dependencias
`PrismaService`, `OrgRoleGuard`/`OrgRoles` (de `common/`).

## Flujo de funcionamiento
1. **Crear organización** (`POST /organizations`): cualquier usuario autenticado puede crear una — se convierte automáticamente en `OWNER` (transacción implícita vía `create` anidado de Prisma: organización + membership en una sola escritura). El slug se deriva del nombre (normalizado, sin acentos/símbolos) y se resuelve una colisión añadiendo un sufijo aleatorio.
2. **Leer/editar organización** (`GET/PATCH /organizations/:id`): protegidos por `OrgRoleGuard`, que resuelve la organización desde `:id` y verifica membresía. `PATCH` exige además `@OrgRoles(OWNER, ADMIN)`.
3. **Listar miembros** (`GET /organizations/:id/members`): cualquier miembro (cualquier rol) puede verlo.
4. **Invitar** (`POST /organizations/:id/invitations`): solo `OWNER`/`ADMIN`. Genera un token opaco de invitación con expiración de 7 días.
5. **Aceptar invitación** (`POST /invitations/:token/accept`): sin `OrgRoleGuard` — quien acepta, por definición, todavía no es miembro. Se valida que el email del usuario autenticado coincida con el de la invitación, que no haya expirado y que no se haya usado ya; luego crea la `Membership` con el rol que definió quien invitó.

## Endpoints
| Método | Ruta | Auth | Rol mínimo |
|---|---|---|---|
| POST | `/organizations` | JWT | ninguno (crea y se hace OWNER) |
| GET | `/organizations/:id` | JWT + membresía | cualquiera |
| PATCH | `/organizations/:id` | JWT + membresía | OWNER/ADMIN |
| GET | `/organizations/:id/members` | JWT + membresía | cualquiera |
| POST | `/organizations/:id/invitations` | JWT + membresía | OWNER/ADMIN |
| POST | `/invitations/:token/accept` | JWT | ninguno (no es miembro todavía) |

## Decisiones de diseño
- **Un usuario puede pertenecer a varias organizaciones** (`Membership` es una tabla de unión, no una FK directa en `User`) — refleja que BusinessBrain es multi-tenant desde el modelo, no una limitación añadida después.
- **`OrgRoleGuard` resuelve la organización por convención de nombre de parámetro** (`:id` o `:organizationId`) o por header `x-org-id` — se decidió no forzar todas las rutas a usar `:organizationId` porque `/organizations/:id` es más natural para el recurso raíz.
- **La invitación valida el email exacto**, no solo la existencia de un token válido — evita que un enlace de invitación reenviado accidentalmente a otra persona le dé acceso.

## Ampliaciones futuras
- Revocar/reenviar invitaciones pendientes (hoy solo se pueden crear y aceptar).
- Eliminar/cambiar el rol de un miembro existente (`DELETE /organizations/:id/members/:userId`, `PATCH .../members/:userId`) — no estaba en el alcance mínimo de la Fase 1.
- Auditoría (`AuditLog`) de cambios de rol e invitaciones — ya cubierta: `AuditService` es el escritor único de `AuditLog` desde la subfase 6.2.
