import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { OnboardingPage } from '../pages/OnboardingPage';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

/**
 * El marco del producto de cliente.
 *
 * ## La navegación cuenta cómo funciona el producto
 *
 * Once secciones en una fila horizontal son once cosas sueltas: quien entra por primera vez no
 * tiene forma de saber cuáles van antes y cuáles después, ni cuáles usará a diario y cuáles
 * una vez al mes. Y a 1024 px —el ancho de un portátil normal— la fila no cabía.
 *
 * Agrupadas dicen el recorrido del producto:
 *
 * - **Entender**: de dónde sale lo que sabe y cómo preguntárselo.
 * - **Decidir**: lo que ha encontrado y lo que tú decides que importa.
 * - **Ejecutar**: lo que se hace solo y lo que te llevas.
 *
 * No son categorías inventadas para el menú: son las tres cosas que hace el producto, en el
 * orden en el que se hacen.
 *
 * ## Barra lateral en escritorio, menú en pantallas pequeñas
 *
 * Un grupo necesita un rótulo encima, y un rótulo encima no cabe en una barra horizontal. Por
 * debajo de 1024 px la misma estructura vive detrás del botón de menú, con los mismos rótulos.
 *
 * Las rutas siguen en castellano —son parte de la URL y cambiarlas rompería los enlaces que la
 * gente tenga guardados— pero lo que se lee sale del catálogo.
 */
type Entrada = { to: string; label: TranslationKey; end?: boolean };

const GRUPOS: { titulo: TranslationKey; entradas: Entrada[] }[] = [
  {
    titulo: 'nav.group.understand',
    entradas: [
      { to: '/', label: 'nav.dashboard', end: true },
      // Preguntar va lo más arriba posible: es lo que una persona quiere hacer al entrar, y
      // lo que hace evidente para qué sirve todo lo demás.
      { to: '/preguntar', label: 'nav.ask' },
      { to: '/conocimiento', label: 'nav.knowledge' },
    ],
  },
  {
    titulo: 'nav.group.decide',
    entradas: [
      { to: '/insights', label: 'nav.insights' },
      { to: '/objetivos', label: 'nav.objectives' },
      { to: '/analisis', label: 'nav.analysis' },
      // Justo después del análisis: una recomendación es su resultado natural, no una
      // pantalla aparte a la que haya que acordarse de ir.
      { to: '/recomendaciones', label: 'nav.recommendations' },
    ],
  },
  {
    titulo: 'nav.group.execute',
    entradas: [
      { to: '/automatizaciones', label: 'nav.automations' },
      { to: '/informes', label: 'nav.reports' },
    ],
  },
  {
    // Lo que pertenece a la persona y lo que pertenece a la empresa, separado también aquí.
    titulo: 'nav.group.account',
    entradas: [
      { to: '/cuenta', label: 'nav.account' },
      { to: '/configuracion', label: 'nav.settings' },
    ],
  },
];

const enlaceClase = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 t-small transition-colors ${
    isActive
      ? 'bg-accent-soft font-medium text-accent'
      : 'text-ink-soft hover:bg-sunken hover:text-ink'
  }`;

/** Los cuatro grupos con su rótulo. Se usa igual en la barra lateral y en el menú móvil. */
function Grupos({ id }: { id: string }) {
  const t = useT();

  return (
    <>
      {GRUPOS.map((grupo) => (
        <div key={grupo.titulo} className="mb-5 last:mb-0">
          <p
            className="mb-1.5 px-3 t-micro text-faint"
            id={`${id}-${grupo.titulo}`}
          >
            {t(grupo.titulo)}
          </p>
          <ul aria-labelledby={`${id}-${grupo.titulo}`} className="grid gap-0.5">
            {grupo.entradas.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={enlaceClase}>
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

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

  /*
    El selector de empresa sigue siempre visible: cambia lo que se ve en TODAS las pantallas,
    porque es la cabecera `x-org-id` de cada llamada. Esconderlo haría que nadie supiera de
    qué empresa está leyendo. Con una sola empresa, un desplegable de un elemento es ruido.
  */
  const empresa =
    organizations.length > 1 ? (
      <select
        aria-label={t('shell.activeOrganization')}
        className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 t-small text-ink outline-none hover:border-line-strong focus:border-accent"
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
      <span className="block truncate t-small text-ink-soft">
        {organizations[0]?.name}
      </span>
    );

  const quienSoy = (
    <div className="t-fine text-muted">
      <span className="block truncate text-ink-soft">{user?.name}</span>
      <span className="block truncate">{labels.role(role)}</span>
    </div>
  );

  const salir = (
    <button
      type="button"
      onClick={logout}
      className="rounded-md border border-line px-2.5 py-1 t-small text-ink transition-colors hover:border-line-strong hover:bg-sunken"
    >
      {t('shell.logout')}
    </button>
  );

  return (
    <div className="min-h-full lg:flex">
      {/* ── Escritorio: barra lateral ──────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line px-4 py-4">
          <span className="block t-body font-semibold tracking-[-0.01em] text-ink">
            BusinessBrain
          </span>
          <div className="mt-2.5">{empresa}</div>
        </div>

        <nav
          aria-label={t('shell.menu')}
          className="flex-1 overflow-y-auto px-2 py-4"
        >
          <Grupos id="lateral" />
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          {quienSoy}
          {salir}
        </div>
      </aside>

      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        {/* ── Pantallas pequeñas: cabecera con el botón de menú ──────────────── */}
        <header className="border-b border-line bg-surface lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              ref={botonMenu}
              type="button"
              onClick={() => setMenuAbierto((abierto) => !abierto)}
              aria-expanded={menuAbierto}
              aria-controls="menu-principal"
              aria-label={t('shell.menu')}
              className="-ml-1 rounded-md p-2 text-ink transition-colors hover:bg-sunken"
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
            <span className="min-w-0 flex-1 truncate t-small text-muted">
              {organizations.length > 1 ? null : organizations[0]?.name}
            </span>

            <div className="ml-auto">{salir}</div>
          </div>
        </header>

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
              className="relative z-20 border-b border-line bg-surface px-2 pb-4 pt-3 shadow-lifted lg:hidden"
            >
              {organizations.length > 1 && (
                <div className="mb-4 px-1">{empresa}</div>
              )}
              <Grupos id="movil" />
            </nav>
          </>
        )}

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-8 sm:py-10">
          {/* La organización activa forma parte de la clave: al cambiarla, cada pantalla se
              vuelve a montar y no arrastra datos de la anterior. */}
          <Outlet key={organizationId ?? 'sin-organizacion'} />
        </main>
      </div>
    </div>
  );
}
