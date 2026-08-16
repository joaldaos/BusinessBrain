import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
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

  if (loading) {
    return (
      <p className="p-8 text-sm text-gray-500">Cargando tu sesión…</p>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return <Shell />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Protected />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/conocimiento" element={<KnowledgePage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/insights/:insightId" element={<InsightDetailPage />} />
          <Route path="/objetivos" element={<ObjectivesPage />} />
          <Route path="/analisis" element={<AnalysisPage />} />
          <Route path="/automatizaciones" element={<AutomationsPage />} />
          <Route path="/informes" element={<ReportsPage />} />
          <Route path="/configuracion" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
