import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { OnboardingPage } from '../pages/OnboardingPage';
import { Button } from './ui';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * La navegación guarda CLAVES, no rótulos.
 *
 * Las rutas siguen en castellano —son parte de la URL y cambiarlas rompería los enlaces que la
 * gente tenga guardados— pero lo que se lee sale del catálogo. Es la diferencia entre traducir
 * el producto y traducir sus direcciones, que no es lo mismo ni tiene por qué ir junto.
 */
const NAV: { to: string; label: TranslationKey; end?: boolean }[] = [
  { to: '/', label: 'nav.dashboard', end: true },
  // Segundo, y a propósito: preguntar es lo que una persona quiere hacer al entrar, y lo que
  // hace evidente para qué sirve todo lo demás.
  { to: '/preguntar', label: 'nav.ask' },
  { to: '/conocimiento', label: 'nav.knowledge' },
  { to: '/insights', label: 'nav.insights' },
  { to: '/objetivos', label: 'nav.objectives' },
  { to: '/analisis', label: 'nav.analysis' },
  // Justo despues del analisis: una recomendacion es su resultado natural, no una pantalla
  // aparte a la que haya que acordarse de ir.
  { to: '/recomendaciones', label: 'nav.recommendations' },
  { to: '/automatizaciones', label: 'nav.automations' },
  { to: '/informes', label: 'nav.reports' },
  { to: '/configuracion', label: 'nav.settings' },
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
  const t = useT();
  const labels = useLabels();

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
            aria-label={t('shell.activeOrganization')}
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
            {/* El rol se traduce: `OWNER` no le dice nada a nadie que no haya escrito el
                esquema. */}
            {user?.name} · {labels.role(role)}
          </span>
          <Button variant="secondary" onClick={logout}>
            {t('shell.logout')}
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
              {t(item.label)}
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
