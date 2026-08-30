import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useT, type TranslationKey } from "../i18n";
import { LanguagePicker } from "../components/LanguagePicker";
import { MfaGate } from "./MfaGate";

/**
 * El marco del panel de operación.
 *
 * ## Por qué NO reutiliza el `Shell` de cliente
 *
 * No es una preferencia estética: es la garantía puesta donde se ve. El `Shell` de cliente
 * gira alrededor del selector de organización activa, porque allí todo lo que se lee pertenece
 * a UNA empresa. Aquí no hay organización activa y no puede haberla — quien administra la
 * plataforma no pertenece a ninguna.
 *
 * Compartir el marco habría exigido un `if` que escondiera el selector, y un `if` en el marco
 * es la primera grieta por la que se cuela la confusión que toda esta arquitectura existe para
 * impedir. Dos marcos distintos hacen imposible mirar una pantalla y no saber dónde estás.
 *
 * ## Mismo ADN visual, distinta piel
 *
 * Desde la Fase 8 las piezas son las mismas que las del producto de cliente: la misma escala
 * tipográfica, los mismos botones, los mismos estados. Lo que cambia es la cabecera —oscura,
 * con el distintivo de operación— y eso basta para que nadie confunda una pestaña con otra.
 * Que se vea distinto no exigía tener otra tipografía.
 */
const NAV: { to: string; label: TranslationKey; end?: boolean }[] = [
  { to: "/platform", label: "platform.nav.overview", end: true },
  { to: "/platform/assistant", label: "platform.nav.assistant" },
  { to: "/platform/organizations", label: "platform.nav.organizations" },
  { to: "/platform/users", label: "platform.nav.users" },
  { to: "/platform/access", label: "platform.nav.access" },
  { to: "/platform/audit", label: "platform.nav.audit" },
  { to: "/platform/account", label: "platform.nav.account" },
];

export function PlatformShell() {
  const { user, logout } = useAuth();
  const t = useT();
  const location = useLocation();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);

  useEffect(() => setMenuAbierto(false), [location.pathname]);

  useEffect(() => {
    if (!menuAbierto) return;
    const cerrar = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuAbierto(false);
        botonMenu.current?.focus();
      }
    };
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [menuAbierto]);

  /**
   * Sin segundo factor no se puede administrar, y hay que decirlo así.
   *
   * Antes cada pantalla disparaba sus llamadas, el backend respondía 403 a todas y el panel
   * enseñaba dos cajas que decían "puede ser un problema momentáneo de conexión". Era falso:
   * no había ningún problema de conexión, faltaba activar la verificación en dos pasos. Y
   * nadie lo decía.
   *
   * La puerta sigue estando en `SuperAdminGuard`; esto solo evita chocarse contra ella a
   * ciegas.
   */
  const necesitaMfa = user?.platformRole === "SUPERADMIN" && !user.mfaEnabled;
  const enCuenta = location.pathname === "/platform/account";

  const visible = necesitaMfa
    ? NAV.filter((item) => item.to === "/platform/account")
    : NAV;

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3.5 sm:px-6">
          <button
            ref={botonMenu}
            type="button"
            onClick={() => setMenuAbierto((abierto) => !abierto)}
            aria-expanded={menuAbierto}
            aria-controls="menu-plataforma"
            aria-label={t("shell.menu")}
            className="-ml-1 rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white md:hidden"
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

          <div className="flex items-baseline gap-2.5">
            <span className="t-body font-semibold tracking-[-0.01em]">
              BusinessBrain
            </span>
            <span className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.09em] text-white/70">
              {t("platform.chrome.badge")}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden t-small text-white/55 sm:inline">
              {user?.name}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-white/20 px-2.5 py-1 t-small text-white/85 transition-colors hover:border-white/45 hover:text-white"
            >
              {t("shell.logout")}
            </button>
          </div>
        </div>

        <nav
          aria-label={t("shell.menu")}
          className="mx-auto hidden max-w-7xl gap-6 px-6 md:flex"
        >
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `-mb-px whitespace-nowrap border-b-2 pb-3 t-small transition-colors ${
                  isActive
                    ? "border-white font-medium text-white"
                    : "border-transparent text-white/55 hover:text-white/85"
                }`
              }
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </header>

      {menuAbierto && (
        <nav
          id="menu-plataforma"
          aria-label={t("shell.menu")}
          className="border-b border-line bg-surface px-4 py-2 shadow-lifted sm:px-6 md:hidden"
        >
          <ul className="grid gap-0.5">
            {visible.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2.5 t-body transition-colors ${
                      isActive
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-ink-soft hover:bg-sunken"
                    }`
                  }
                >
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/*
        La frase que ordena el panel entero. No es decoración: es lo primero que se lee al
        entrar, y dice exactamente dónde está la frontera. Quien opera BusinessBrain administra
        el producto; los datos de los clientes siguen siendo suyos.
      */}
      <p className="border-b border-line bg-surface px-4 py-2.5 text-center t-small text-muted sm:px-6">
        {t("platform.chrome.boundary")}
      </p>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 sm:py-9">
        {necesitaMfa && !enCuenta ? <MfaGate /> : <Outlet />}
      </main>

      <footer className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6">
        <LanguagePicker compact />
      </footer>
    </div>
  );
}
