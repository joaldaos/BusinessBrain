import { SecurityCard } from "../components/SecurityCard";
import { useT } from "../i18n";
import { PageHeader, usePageTitle } from "./ui";

/**
 * La seguridad de la propia cuenta de operación.
 *
 * ## Por qué esta pantalla tuvo que existir
 *
 * El segundo factor es OBLIGATORIO para administrar: sin él, `SuperAdminGuard` cierra todo
 * `/platform/*` salvo la propia cuenta. Y la única pantalla donde se activaba vivía dentro del
 * producto de cliente, al que quien administra la plataforma no puede entrar — no tiene
 * organización, y el marco de cliente le habría enseñado "crea tu empresa", que es una acción
 * que el backend le rechaza por la invariante de la Fase 1.
 *
 * Quedaba, literalmente, sin forma de cumplir un requisito obligatorio. Lo encontró el
 * recorrido de navegador al intentar activarlo, no una revisión del código.
 *
 * ## Y por qué reutiliza el componente del producto de cliente
 *
 * `SecurityCard` no es una pantalla de tenant: es una pantalla de CUENTA. Habla con
 * `/auth/mfa` y `/auth/password`, que no saben nada de organizaciones. Duplicarla habría
 * significado dos altas de segundo factor que hay que mantener iguales — y el día que
 * discrepen, una de las dos dejará de exigir algo.
 */
export function PlatformAccountPage() {
  usePageTitle("platform.nav.account");
  const t = useT();

  return (
    <>
      <PageHeader
        title={t("platform.account.title")}
        description={t("platform.account.subtitle")}
      />
      <SecurityCard />
    </>
  );
}
