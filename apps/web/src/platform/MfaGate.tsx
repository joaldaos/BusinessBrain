import { Link } from "react-router-dom";
import { useT } from "../i18n";
import { PageHeader, Section, usePageTitle } from "./ui";

/**
 * Lo que ve quien administra BusinessBrain y todavía no ha activado el segundo factor.
 *
 * ## El problema que resuelve
 *
 * El segundo factor es obligatorio para administrar (Fase 4), así que sin él **todas** las
 * llamadas de `/platform/*` responden 403. Hasta ahora, cada pantalla disparaba las suyas, se
 * las denegaban todas, y el panel enseñaba dos cajas de error diciendo:
 *
 * > "No se ha podido cargar esta información. Puede ser un problema momentáneo de conexión."
 *
 * Era **falso**. No había ningún problema de conexión: faltaba un requisito de seguridad que
 * nadie mencionaba. Quien entraba por primera vez veía un panel roto y tenía que descubrir
 * "Mi cuenta" en el menú mirando dos errores que le mandaban a investigar la red.
 *
 * ## Y lo que esto NO es
 *
 * No es una comprobación de seguridad. Quien deniega sigue siendo `SuperAdminGuard`, en el
 * servidor, y la misma llamada hecha a mano seguiría respondiendo 403. Esto solo evita
 * chocarse contra esa puerta a ciegas — y aprovecha para explicar por qué está cerrada, que
 * es información que el administrador necesita y que un 403 no transmite.
 */
export function MfaGate() {
  const t = useT();
  usePageTitle("platform.mfaGate.title");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t("platform.mfaGate.title")}
        description={t("platform.mfaGate.subtitle")}
      />

      <Section>
        <p className="t-body leading-relaxed text-ink-soft">
          {t("platform.mfaGate.why")}
        </p>

        <ol className="mt-5 space-y-3">
          {(
            [
              "platform.mfaGate.step1",
              "platform.mfaGate.step2",
              "platform.mfaGate.step3",
            ] as const
          ).map((clave, indice) => (
            <li key={clave} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[0.6875rem] font-semibold text-muted">
                {indice + 1}
              </span>
              <span className="t-small text-ink-soft">{t(clave)}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6">
          <Link
            to="/platform/account"
            className="inline-flex items-center rounded-md border border-transparent bg-ink px-3.5 py-2 t-small font-medium text-white transition-colors hover:bg-ink-soft"
          >
            {t("platform.mfaGate.action")}
          </Link>
        </div>
      </Section>

      <p className="mt-4 px-1 t-small text-muted">
        {t("platform.mfaGate.footnote")}
      </p>
    </div>
  );
}
