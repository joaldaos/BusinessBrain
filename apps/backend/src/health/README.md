# HealthModule

## Responsabilidad
Exponer `/health` para verificar que el proceso arrancó y que su dependencia crítica (PostgreSQL) responde. Equivalente a `/api/health` de Drop, ahora con una comprobación real de conectividad en vez de solo devolver `{ ok: true }`.

## Dependencias
`@nestjs/terminus`, `PrismaService`.

## Flujo de funcionamiento
`GET /health` ejecuta `PrismaHealthIndicator.check()`, que hace `SELECT 1` contra PostgreSQL vía Prisma. Si responde, `200` con el reporte de Terminus; si falla, `503` con el detalle del error.

## Endpoints
| Método | Ruta | Auth |
|---|---|---|
| GET | `/health` | pública (`@Public()`) |

## Decisiones de diseño
- **Comprobación real de DB, no un ping fijo**: un `{ ok: true }` estático (como en Drop) no detecta que la app está arriba pero la base de datos caída — un escenario real en despliegues.
- **Solo comprueba PostgreSQL en esta fase**: Redis/BullMQ no tienen todavía ningún consumidor real (llegan con `IngestionModule`/`AutomationsModule`, fases posteriores) — añadir una comprobación de una dependencia que nada usa aún sería ruido, no señal.

## Ampliaciones futuras
- Indicador de salud de Redis cuando `IngestionModule`/`AutomationsModule` empiecen a depender de BullMQ (Fase 2+).
- Distinguir `/health/live` (proceso vivo) de `/health/ready` (dependencias listas) si el despliegue lo necesita (p. ej. Kubernetes).
