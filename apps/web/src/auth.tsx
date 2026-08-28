import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, session } from './api/client';
import type { CurrentUser, MembershipRole, Organization } from './api/types';

/**
 * Sesión y organización activa.
 *
 * ## El rol viene del backend, no se deduce aquí
 *
 * `GET /auth/me` devuelve las membresías reales del usuario con su rol. La interfaz lo usa
 * para no ofrecer acciones que la API va a rechazar, pero **nunca para autorizar**: quien
 * decide es `OrgRoleGuard`. Ocultar un botón es cortesía; la puerta sigue cerrada por detrás.
 *
 * ## Por qué hay que elegir organización
 *
 * Casi ninguna ruta lleva el identificador de la organización en el path: `OrgRoleGuard` lo
 * resuelve desde la cabecera `x-org-id`. Sin una organización activa no se puede hablar con
 * la API, así que la elección es parte de la sesión, no una preferencia de la interfaz.
 */

interface AuthState {
  user: CurrentUser | null;
  organizations: Organization[];
  organizationId: string | null;
  role: MembershipRole | undefined;
  loading: boolean;
  /**
   * Entra, o devuelve el testigo del segundo paso si la cuenta lleva verificación en dos pasos.
   *
   * Devolverlo en vez de guardarlo aquí es deliberado: quien decide qué hacer con él es la
   * pantalla de entrada, que es la única que puede enseñar el campo del código. Guardarlo en el
   * contexto convertiría "he puesto la contraseña" en un estado global de media sesión.
   */
  login: (
    email: string,
    password: string,
  ) => Promise<{ mfaToken: string } | null>;
  /** El segundo paso: el código de la aplicación, o uno de repuesto. */
  completeMfaLogin: (mfaToken: string, code: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
  }) => Promise<void>;
  selectOrganization: (organizationId: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(
    session.organizationId,
  );
  const [loading, setLoading] = useState(true);

  /**
   * Carga la sesión y resuelve el NOMBRE de cada organización.
   *
   * `/auth/me` solo devuelve identificadores de membresía. Enseñar un cuid al usuario sería
   * inservible, así que cada organización se resuelve por su ruta — que además comprueba la
   * membresía otra vez, del lado correcto.
   */
  const loadUser = useCallback(async () => {
    const me = await api<CurrentUser>('/auth/me', {
      withoutOrganization: true,
    });
    setUser(me);

    const resolved = await Promise.all(
      me.memberships.map(async (membership) => {
        try {
          return await api<Organization>(
            `/organizations/${membership.organizationId}`,
            { withoutOrganization: true },
          );
        } catch {
          // Una organización que no resuelve no debe romper el arranque de la sesión.
          return null;
        }
      }),
    );
    const visible = resolved.filter((org): org is Organization => org !== null);
    setOrganizations(visible);

    // Si la guardada ya no vale (le retiraron la membresía), se cae a la primera disponible
    // en vez de dejar la interfaz respondiendo 403 sin explicación.
    const stored = session.organizationId;
    const valid = stored && me.memberships.some((m) => m.organizationId === stored);
    const next = valid ? stored : (visible[0]?.id ?? null);
    if (next) session.selectOrganization(next);
    setOrganizationId(next);
  }, []);

  useEffect(() => {
    if (!session.maybeAuthenticated) {
      setLoading(false);
      return;
    }
    // Tras una recarga no hay token de acceso en memoria, pero el navegador conserva la
    // cookie del refresco: la primera llamada dará 401 y el cliente la renovará sola.
    loadUser()
      .catch(() => session.clear())
      .finally(() => setLoading(false));
  }, [loadUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api<{
        accessToken?: string;
        csrfToken?: string;
        mfaRequired?: boolean;
        mfaToken?: string;
      }>('/auth/login', {
        method: 'POST',
        body: { email, password },
        withoutOrganization: true,
      });

      // Con verificación en dos pasos, la contraseña correcta NO abre sesión: aquí no hay
      // token de acceso todavía y no lo habrá hasta que llegue un código válido.
      if (result.mfaRequired && result.mfaToken) {
        return { mfaToken: result.mfaToken };
      }

      // La respuesta ya no trae el token de refresco: viaja en una cookie que este código no
      // puede leer. Lo único que se guarda es el token de acceso y el testigo CSRF.
      session.start(result as { accessToken: string; csrfToken: string });
      await loadUser();
      return null;
    },
    [loadUser],
  );

  const completeMfaLogin = useCallback(
    async (mfaToken: string, code: string) => {
      const result = await api<{ accessToken: string; csrfToken: string }>(
        '/auth/login/mfa',
        {
          method: 'POST',
          body: { mfaToken, code },
          withoutOrganization: true,
        },
      );
      session.start(result);
      await loadUser();
    },
    [loadUser],
  );

  const register = useCallback(
    async (input: { email: string; password: string; name: string }) => {
      await api('/auth/register', {
        method: 'POST',
        body: input,
        withoutOrganization: true,
      });
      // Una cuenta recién creada no puede tener verificación en dos pasos, así que aquí nunca
      // hay segundo paso que atender.
      await login(input.email, input.password);
    },
    [login],
  );

  const selectOrganization = useCallback((next: string) => {
    session.selectOrganization(next);
    setOrganizationId(next);
  }, []);

  const logout = useCallback(() => {
    // Cerrar sesión es ahora obligatoriamente cosa del servidor: es quien revoca el token y
    // quien borra la cookie, porque este código no puede tocarla. Si la llamada falla, la
    // sesión local se limpia igualmente — dejar a la persona dentro sería peor.
    void api('/auth/logout', {
      method: 'POST',
      withoutOrganization: true,
      withCsrf: true,
    }).catch(() => undefined);

    session.clear();
    setUser(null);
    setOrganizations([]);
    setOrganizationId(null);
  }, []);

  const role = useMemo(
    () =>
      user?.memberships.find((m) => m.organizationId === organizationId)?.role,
    [user, organizationId],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      organizations,
      organizationId,
      role,
      loading,
      login,
      completeMfaLogin,
      register,
      selectOrganization,
      logout,
      refreshUser: loadUser,
    }),
    [
      user,
      organizations,
      organizationId,
      role,
      loading,
      login,
      completeMfaLogin,
      register,
      selectOrganization,
      logout,
      loadUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth fuera de AuthProvider');
  return context;
}
