import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { useT, type TranslationKey } from '../i18n';
import { LanguagePicker } from '../components/LanguagePicker';

/**
 * El marco del panel de operación.
 *
 * ## Por qué NO reutiliza el `Shell` de cliente
 *
 * No es una preferencia estética: es la garantía puesta donde se ve. El `Shell` de cliente
 * gira alrededor del selector de organización activa, porque ahí todo lo que se lee pertenece
 * a UNA empresa. Aquí no hay organización activa y no puede haberla — quien administra la
 * plataforma no pertenece a ninguna.
 *
 * Compartir el marco habría exigido un `if` que escondiera el selector, y un `if` en el marco
 * es la primera grieta por la que se cuela la confusión que toda esta arquitectura existe para
 * impedir. Dos marcos distintos hacen imposible mirar una pantalla y no saber dónde estás.
 *
 * ## Y por eso el fondo es oscuro
 *
 * El producto de cliente es claro. Este es oscuro en la cabecera y arranca con una frase que
 * dice literalmente qué es esto y qué no. Alguien que llegue con las dos pestañas abiertas
 * tiene que saber en cuál está antes de leer nada.
 */
const NAV: { to: string; label: TranslationKey; end?: boolean }[] = [
  { to: '/platform', label: 'platform.nav.overview', end: true },
  { to: '/platform/assistant', label: 'platform.nav.assistant' },
  { to: '/platform/organizations', label: 'platform.nav.organizations' },
  { to: '/platform/users', label: 'platform.nav.users' },
  { to: '/platform/access', label: 'platform.nav.access' },
  { to: '/platform/audit', label: 'platform.nav.audit' },
  { to: '/platform/account', label: 'platform.nav.account' },
];

export function PlatformShell() {
  const { user, logout } = useAuth();
  const t = useT();

  return (
    <div className="flex min-h-full flex-col bg-[#f7f8fa]">
      <header className="bg-[#14161a] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-semibold tracking-tight">
              BusinessBrain
            </span>
            <span className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-white/70">
              {t('platform.chrome.badge')}
            </span>
          </div>

          <span className="ml-auto text-[13px] text-white/60">
            {user?.name}
          </span>
          <button
            type="button"
            onClick={logout}
            className="rounded border border-white/20 px-2.5 py-1 text-[13px] text-white/80 transition hover:border-white/40 hover:text-white"
          >
            {t('shell.logout')}
          </button>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-6">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `-mb-px whitespace-nowrap border-b-2 pb-3 text-[13px] transition ${
                  isActive
                    ? 'border-white font-medium text-white'
                    : 'border-transparent text-white/55 hover:text-white/85'
                }`
              }
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </header>

      {/*
        La frase que ordena el panel entero. No es decoración: es lo primero que se lee al
        entrar, y dice exactamente dónde está la frontera. Quien opera BusinessBrain administra
        el producto; los datos de los clientes siguen siendo suyos.
      */}
      <p className="border-b border-line bg-white px-6 py-2.5 text-center text-[12px] text-muted">
        {t('platform.chrome.boundary')}
      </p>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-7xl px-6 pb-8">
        <LanguagePicker compact />
      </footer>
    </div>
  );
}
