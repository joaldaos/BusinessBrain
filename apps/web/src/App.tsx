import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { I18nProvider, useT } from './i18n';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import {
  PasswordRecoveryPage,
  PasswordResetPage,
} from './pages/PasswordRecoveryPage';
import { AskPage } from './pages/AskPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { DashboardPage } from './pages/DashboardPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { InsightsPage } from './pages/InsightsPage';
import { InsightDetailPage } from './pages/InsightDetailPage';
import { ObjectivesPage } from './pages/ObjectivesPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PlatformShell } from './platform/PlatformShell';
import { PlatformOverviewPage } from './platform/OverviewPage';
import { PlatformOrganizationsPage } from './platform/OrganizationsPage';
import { PlatformOrganizationDetailPage } from './platform/OrganizationDetailPage';
import {
  PlatformUserDetailPage,
  PlatformUsersPage,
} from './platform/UsersPage';
import { PlatformMyAccessPage } from './platform/MyAccessPage';
import { PlatformAuditPage } from './platform/AuditPage';
import { PlatformAccountPage } from './platform/AccountPage';

function Protected() {
  const { user, loading } = useAuth();
  const t = useT();

  if (loading) {
    return <p className="p-8 text-sm text-gray-500">{t('common.sessionLoading')}</p>;
  }
  if (!user) return <Navigate to="/login" replace />;

  /**
   * Quien administra la plataforma no tiene sitio aquí, y hay que llevarle al suyo.
   *
   * Sin esto, `Shell` veía cero organizaciones y le enseñaba la pantalla de "crea tu empresa" —
   * que además es una acción que el backend le va a rechazar por la invariante de la Fase 1.
   * El administrador quedaba atrapado en un callejón sin salida que además le proponía romper
   * la regla que sostiene el aislamiento.
   */
  if (user.platformRole === 'SUPERADMIN') {
    return <Navigate to="/platform" replace />;
  }

  return <Shell />;
}

/**
 * La puerta del panel de operación.
 *
 * Es cortesía de pantalla, no autorización: quien decide sigue siendo `SuperAdminGuard` en el
 * backend, y la misma llamada hecha a mano seguiría respondiendo 403. Lo que esto evita es que
 * alguien de una empresa cliente que teclee `/platform` vea una pantalla rota llena de errores
 * en vez de un no claro.
 */
function PlatformProtected() {
  const { user, loading } = useAuth();
  const t = useT();

  if (loading) {
    return <p className="p-8 text-sm text-gray-500">{t('common.sessionLoading')}</p>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.platformRole !== 'SUPERADMIN') return <Navigate to="/" replace />;

  return <PlatformShell />;
}

/**
 * El idioma se resuelve DENTRO de la sesión.
 *
 * `I18nProvider` necesita saber qué idioma eligió la persona, y quien conoce la sesión es
 * `AuthProvider`. De ahí este envoltorio de tres líneas en vez de que el proveedor de idioma
 * llame a la API por su cuenta: dos sitios leyendo la sesión acaban discrepando sobre quién ha
 * entrado.
 *
 * Cuando todavía no hay nadie —la pantalla de entrada, la de recuperar contraseña— manda el
 * idioma del navegador.
 */
function Localized({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <I18nProvider preferred={user?.locale}>{children}</I18nProvider>;
}

export function App() {
  return (
    <AuthProvider>
      <Localized>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Fuera de `Protected` a propósito: a quien no puede entrar no se le puede pedir
              que esté dentro. */}
          <Route path="/recuperar" element={<PasswordRecoveryPage />} />
          <Route path="/restablecer" element={<PasswordResetPage />} />
          {/*
            El panel de operación va ANTES del grupo de cliente y con su propio marco. No
            comparte nada de la superficie de tenant: ni shell, ni organización activa, ni
            navegación. Es la separación de la arquitectura, puesta donde se ve.
          */}
          <Route element={<PlatformProtected />}>
            <Route path="/platform" element={<PlatformOverviewPage />} />
            <Route
              path="/platform/organizations"
              element={<PlatformOrganizationsPage />}
            />
            <Route
              path="/platform/organizations/:organizationId"
              element={<PlatformOrganizationDetailPage />}
            />
            <Route path="/platform/users" element={<PlatformUsersPage />} />
            <Route
              path="/platform/users/:userId"
              element={<PlatformUserDetailPage />}
            />
            <Route path="/platform/access" element={<PlatformMyAccessPage />} />
            <Route path="/platform/audit" element={<PlatformAuditPage />} />
            <Route
              path="/platform/account"
              element={<PlatformAccountPage />}
            />
          </Route>

          <Route element={<Protected />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/preguntar" element={<AskPage />} />
            <Route path="/conocimiento" element={<KnowledgePage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/insights/:insightId" element={<InsightDetailPage />} />
            <Route path="/objetivos" element={<ObjectivesPage />} />
            <Route path="/analisis" element={<AnalysisPage />} />
            <Route path="/recomendaciones" element={<RecommendationsPage />} />
            <Route path="/automatizaciones" element={<AutomationsPage />} />
            <Route path="/informes" element={<ReportsPage />} />
            <Route path="/configuracion" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Localized>
    </AuthProvider>
  );
}
