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

function Protected() {
  const { user, loading } = useAuth();
  const t = useT();

  if (loading) {
    return <p className="p-8 text-sm text-gray-500">{t('common.sessionLoading')}</p>;
  }
  if (!user) return <Navigate to="/login" replace />;

  return <Shell />;
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
