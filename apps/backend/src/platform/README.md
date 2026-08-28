# PlatformModule

## Responsabilidad

La superficie de quien **opera** BusinessBrain, no de quien lo usa. Reemplaza al antiguo
`AdminModule` y a su prefijo `/admin/*`: había dos nombres posibles para lo mismo y mantener
los dos habría sido dos puertas a las mismas habitaciones.

## La frontera que sostiene este módulo

Hay dos cosas que se parecen y no lo son:

| | Qué es | Dónde vive | Qué hace falta |
|---|---|---|---|
| **El catálogo** | Quiénes son nuestros clientes, qué plan tienen, cuánta gente son | Este módulo | Ser administrador |
| **La inspección** | Qué hay dentro de una empresa: sus fuentes, sus fallos, sus documentos | `PlatformAccessModule` | Una **concesión** motivada, acotada y con fecha de fin |

La línea es «sobre la relación» contra «sobre su negocio». Está trazada por **rutas distintas
y consultas distintas**, no por un `if` que decida cuánto devolver.

## Endpoints

| Método | Ruta | Reautenticación | Auditoría |
|---|---|---|---|
| GET | `/platform/overview` | — | — |
| GET | `/platform/organizations?page=` | — | — |
| GET | `/platform/organizations/:id` | — | — |
| POST | `/platform/organizations/:id/plan` | **Sí** | `platform.organization.plan_changed` |
| GET | `/platform/users?page=` | — | `platform.users.listed` |
| GET | `/platform/users/:id` | — | `platform.users.listed` |
| POST | `/platform/users/:id/ban` | **Sí** | `platform.user.banned` |
| POST | `/platform/users/:id/unban` | **Sí** | `platform.user.unbanned` |
| POST | `/platform/users/:id/mfa/remove` | **Sí** | `platform.user.mfa_removed` |
| GET | `/platform/audit` | — | — |
| GET | `/platform/audit/actions` | — | — |

Las rutas de **concesión e inspección** (`/platform/organizations/:id/access`, `/overview`,
`/diagnostics`, `/documents`) viven en `PlatformAccessModule`, que es donde está su lógica.

## Decisiones de diseño

- **Guard a nivel de clase.** Cualquier ruta que se añada a estos controladores hereda
  `SuperAdminGuard` sin que nadie tenga que acordarse. `RecentAuthGuard` sí va por método:
  no todas las rutas son sensibles, y ponerlo en la clase obligaría a excluir las lecturas.

- **`ban` y `unban` en vez de un interruptor.** Era un `toggle`, y para una acción sensible
  eso está mal: la interfaz puede pedir un bloqueo y provocar un desbloqueo si el estado
  cambió entre que pintó la pantalla y que alguien pulsó, y un doble clic se anula a sí mismo
  dejando dos entradas de auditoría contradictorias. Declarando el estado destino, repetir la
  llamada es inofensivo.

- **No se puede bloquear a una cuenta de plataforma.** Bloquearse a uno mismo deja el producto
  sin nadie que pueda desbloquearlo; bloquear al otro administrador permite que quien
  comprometa una cuenta deje fuera a quien podría pararle.

- **Selección explícita en todas las consultas.** Nunca la fila entera. `settings` acumula
  configuración del cliente y `User` guarda el hash de la contraseña y el secreto del segundo
  factor: un `select` ausente los devolvería el día que alguien añada un campo.

- **Leer la auditoría no se audita; leer personas sí.** La primera crearía un bucle en el que
  el registro se llena de sus propias consultas. La segunda son datos personales de terceros.

## Lo que este módulo NO hace

- No usa `OrgRoleGuard`. Exige membresía, y quien administra la plataforma no tiene ninguna
  por invariante (Fase 1).
- No devuelve contenido de ningún cliente por ninguna de sus rutas.
- No crea membresías, ni impersona, ni emite sesiones de nadie.
