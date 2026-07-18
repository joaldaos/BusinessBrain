# AuthModule

## Responsabilidad
Autenticación de usuarios a nivel de plataforma: registro, login, rotación de refresh tokens, logout y perfil del usuario autenticado. **No** gestiona pertenencia a organizaciones — eso es responsabilidad de `OrganizationsModule` (un usuario puede existir sin pertenecer a ninguna organización todavía).

## Dependencias
`PrismaService`, `@nestjs/jwt`, `@nestjs/passport` (`passport-jwt`, `passport-local`), `bcryptjs`, `@nestjs/config`.

## Flujo de funcionamiento
1. **`POST /auth/register`**: crea un `User` con `passwordHash` (bcrypt, 10 rounds). No emite tokens — el flujo esperado es registrar y luego hacer login (separar ambos pasos simplifica el manejo de errores en el frontend).
2. **`POST /auth/login`**: `LocalAuthGuard` → `LocalStrategy.validate()` → `AuthService.validateCredentials()`. Si son válidas, `AuthService.issueTokens()` firma un access token JWT (`JWT_ACCESS_SECRET`, corta duración) y genera un refresh token opaco de 32 bytes aleatorios, cuyo hash (HMAC-SHA256 con `JWT_REFRESH_SECRET` como clave) se persiste en `RefreshToken`. El refresh token en claro solo existe en la respuesta al cliente, nunca en la base de datos.
3. **`POST /auth/refresh`**: recalcula el hash del refresh token recibido, busca una fila `RefreshToken` no revocada y no expirada. Si es válida, la revoca (rotación) y emite un par nuevo — un refresh token nunca se reutiliza dos veces.
4. **`POST /auth/logout`**: revoca el refresh token recibido (no afecta al access token, que expira solo por tiempo — ver limitación más abajo).
5. **`GET /auth/me`**: protegido por `JwtAuthGuard` (global). Devuelve `req.user`, que `JwtStrategy.validate()` reconstruye en cada request consultando `User` + `Membership` frescos — un ban o cambio de rol aplica de inmediato, no espera a que expire el token.

## Endpoints
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/register` | pública | Crea la cuenta de usuario |
| POST | `/auth/login` | pública (local strategy) | Devuelve `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh` | pública (el refresh token es la credencial) | Rota el par de tokens |
| POST | `/auth/logout` | pública | Revoca el refresh token indicado |
| GET | `/auth/me` | JWT | Perfil del usuario autenticado + membresías |

## Decisiones de diseño
- **Refresh token opaco + hash, no un segundo JWT.** Permite revocación real (borrar/marcar la fila) — un JWT de refresh sería válido hasta expirar aunque se quisiera invalidar antes.
- **Rotación en cada refresh.** Si un refresh token robado se usa antes que el legítimo, el legítimo deja de servir (queda revocado) — señal para invalidar toda la sesión si se detecta este patrón (no implementado en esta fase, ver ampliaciones).
- **Registro y login separados.** Simplifica el manejo de errores (409 email duplicado vs. 401 credenciales inválidas) sin mezclar ambos flujos en un único endpoint.
- **Limitación conocida y aceptada para esta fase**: no hay revocación de access tokens ya emitidos (son JWT autocontenidos, válidos hasta expirar — por defecto 15 minutos). Para operaciones sensibles (ban de usuario) esto se acepta porque la ventana es corta; una lista de revocación (denylist en Redis) es una ampliación futura, no una necesidad de la Fase 1.

## Ampliaciones futuras
- Denylist de access tokens en Redis para revocación inmediata (hoy: esperar a que expire, máx. 15 min).
- Detección de reuso de refresh token robado → invalidar todas las sesiones del usuario.
- Verificación de email y flujo de "olvidé mi contraseña" (no cubiertos por el roadmap de la Fase 1).
- 2FA (mencionado como posible campo futuro en el modelo de `User`, no en el schema actual).
