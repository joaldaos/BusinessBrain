import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { OnboardingPage } from '../pages/OnboardingPage';
import { Button } from './ui';

const NAV = [
  { to: '/', label: 'Panel', end: true },
  // Segundo, y a propósito: preguntar es lo que una persona quiere hacer al entrar, y lo que
  // hace evidente para qué sirve todo lo demás.
  { to: '/preguntar', label: 'Preguntar' },
  { to: '/conocimiento', label: 'Conocimiento' },
  { to: '/insights', label: 'Comprensión' },
  { to: '/objetivos', label: 'Objetivos' },
  { to: '/analisis', label: 'Análisis' },
  // Justo despues del analisis: una recomendacion es su resultado natural, no una pantalla
  // aparte a la que haya que acordarse de ir.
  { to: '/recomendaciones', label: 'Recomendaciones' },
  { to: '/automatizaciones', label: 'Automatizaciones' },
  { to: '/informes', label: 'Informes' },
  { to: '/configuracion', label: 'Configuración' },
];

/**
 * Marco de la aplicación: navegación, organización activa y salida.
 *
 * El selector de organización está siempre visible porque **cambia lo que se ve en todas las
 * pantallas**: es la cabecera `x-org-id` de cada llamada. Esconderlo en un menú haría que el
 * usuario no supiera de qué empresa está leyendo.
 */
export function Shell() {
  const { user, organizations, organizationId, role, selectOrganization, logout } =
    useAuth();

  // Sin organización no hay producto: casi toda la API la resuelve desde `x-org-id`. Antes
  // esta rama era un callejón sin salida que remitía a la API; ahora es el primer paso.
  if (organizations.length === 0) {
    return <OnboardingPage />;
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="font-semibold tracking-tight">BusinessBrain</span>

          <select
            aria-label="Organización activa"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={organizationId ?? ''}
            onChange={(event) => selectOrganization(event.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>

          <span className="ml-auto text-xs text-gray-500">
            {user?.name} · {role}
          </span>
          <Button variant="secondary" onClick={logout}>
            Salir
          </Button>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded px-3 py-1.5 text-sm ${
                  isActive
                    ? 'bg-blue-50 font-medium text-blue-800'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-4">
        {/* La organización activa forma parte de la clave: al cambiarla, cada pantalla se
            vuelve a montar y no arrastra datos de la anterior. */}
        <Outlet key={organizationId ?? 'sin-organizacion'} />
      </main>
    </div>
  );
}
