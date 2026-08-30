import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { OnboardingPage } from '../pages/OnboardingPage';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * El marco del producto de cliente.
 *
 * ## La navegación guarda CLAVES, no rótulos
 *
 * Las rutas siguen en castellano —son parte de la URL y cambiarlas rompería los enlaces que la
 * gente tenga guardados— pero lo que se lee sale del catálogo.
 *
 * ## Y en móvil hay un menú de verdad
 *
 * Antes la barra era una fila con desplazamiento horizontal. A 375 px se veían cuatro de las
 * once secciones y **no había ninguna pista de que existieran las otras siete**: ni una
 * sombra, ni una flecha, nada. Media aplicación era invisible en un teléfono y quien la usaba
 * no tenía forma de saberlo.
 *
 * Ahora hay un botón que abre la lista entera. Se cierra al navegar, con Escape y al pulsar
 * fuera, y devuelve el foco al botón — que es lo que espera quien navega con teclado.
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
];

/** Lo que pertenece a la persona y lo que pertenece a la empresa, separado también aquí. */
const CUENTA: { to: string; label: TranslationKey; end?: boolean }[] = [
  { to: '/cuenta', label: 'nav.account' },
  { to: '/configuracion', label: 'nav.settings' },
];

export function Shell() {
  const { user, organizations, organizationId, role, selectOrganization, logout } =
    useAuth();
  const t = useT();
  const labels = useLabels();
  const location = useLocation();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);

  // Al navegar, el menú se cierra solo. Dejarlo abierto encima de la pantalla nueva es el
  // fallo más común de los menús móviles hechos a mano.
  useEffect(() => setMenuAbierto(false), [location.pathname]);

  useEffect(() => {
    if (!menuAbierto) return;
    const cerrar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuAbierto(false);
        botonMenu.current?.focus();
      }
    };
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [menuAbierto]);

  // Sin organización no hay producto: casi toda la API la resuelve desde `x-org-id`. Antes
  // esta rama era un callejón sin salida que remitía a la API; ahora es el primer paso.
  if (organizations.length === 0) {
    return <OnboardingPage />;
  }

  const enlace = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-md px-3 py-1.5 t-small transition-colors ${
      isActive
        ? 'bg-accent-soft font-medium text-accent'
        : 'text-muted hover:bg-sunken hover:text-ink'
    }`;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            ref={botonMenu}
            type="button"
            onClick={() => setMenuAbierto((abierto) => !abierto)}
            aria-expanded={menuAbierto}
            aria-controls="menu-principal"
            aria-label={t('shell.menu')}
            className="-ml-1 rounded-md p-2 text-ink transition-colors hover:bg-sunken lg:hidden"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-hidden="true"
            >
              {menuAbierto ? (
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2.5 5h13M2.5 9h13M2.5 13h13"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>

          <span className="t-body font-semibold tracking-[-0.01em]">
            BusinessBrain
          </span>

          {/*
            El selector de empresa sigue siempre visible: cambia lo que se ve en TODAS las
            pantallas, porque es la cabecera `x-org-id` de cada llamada. Esconderlo en un menú
            haría que nadie supiera de qué empresa está leyendo.
          */}
          {organizations.length > 1 ? (
            <select
              aria-label={t('shell.activeOrganization')}
              className="max-w-[10rem] rounded-md border border-line bg-surface px-2 py-1 t-small text-ink outline-none hover:border-line-strong focus:border-accent sm:max-w-none"
              value={organizationId ?? ''}
              onChange={(event) => selectOrganization(event.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          ) : (
            // Con una sola empresa, un desplegable de un elemento es ruido: se dice el nombre.
            <span className="truncate t-small text-muted">
              {organizations[0]?.name}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden t-small text-muted sm:inline">
              {user?.name} · {labels.role(role)}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-line px-2.5 py-1 t-small text-ink transition-colors hover:border-line-strong hover:bg-sunken"
            >
              {t('shell.logout')}
            </button>
          </div>
        </div>

        {/*
          Escritorio: todo a la vista, y en dos filas si hace falta.

          Once secciones no caben en una sola línea a 1024 px —el ancho de un portátil normal—
          y sin `flex-wrap` la última se salía 21 px por la derecha, arrastrando la barra de
          desplazamiento horizontal a TODAS las pantallas. No se veía a 1440 ni a 375, que son
          los dos anchos que se estaban mirando.
        */}
        <nav
          aria-label={t('shell.menu')}
          className="mx-auto hidden max-w-6xl flex-wrap gap-0.5 px-4 pb-2 sm:px-6 lg:flex"
        >
          {[...NAV, ...CUENTA].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={enlace}>
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Móvil: la lista entera, en dos grupos. Ninguna sección escondida. */}
      {menuAbierto && (
        <>
          <div
            className="fixed inset-0 z-10 bg-ink/10 lg:hidden"
            onClick={() => setMenuAbierto(false)}
            aria-hidden="true"
          />
          <nav
            id="menu-principal"
            aria-label={t('shell.menu')}
            className="relative z-20 border-b border-line bg-surface px-4 pb-4 pt-1 shadow-lifted sm:px-6 lg:hidden"
          >
            <ul className="grid gap-0.5">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2.5 t-body transition-colors ${
                        isActive
                          ? 'bg-accent-soft font-medium text-accent'
                          : 'text-ink-soft hover:bg-sunken'
                      }`
                    }
                  >
                    {t(item.label)}
                  </NavLink>
                </li>
              ))}
            </ul>
            <ul className="mt-2 grid gap-0.5 border-t border-line pt-2">
              {CUENTA.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2.5 t-body transition-colors ${
                        isActive
                          ? 'bg-accent-soft font-medium text-accent'
                          : 'text-ink-soft hover:bg-sunken'
                      }`
                    }
                  >
                    {t(item.label)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {/* La organización activa forma parte de la clave: al cambiarla, cada pantalla se
            vuelve a montar y no arrastra datos de la anterior. */}
        <Outlet key={organizationId ?? 'sin-organizacion'} />
      </main>
    </div>
  );
}
