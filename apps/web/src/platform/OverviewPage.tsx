import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useResource } from "../components/ui";
import { useT } from "../i18n";
import {
  DataState,
  Metric,
  PageHeader,
  Section,
  StatusPill,
  usePageTitle,
} from "./ui";
import type { MyGrant, PlatformOverview } from "./types";

/**
 * Lo primero que se ve al entrar a operar.
 *
 * ## Cada número tiene una fuente real
 *
 * No hay ni una métrica inventada, ni una tendencia, ni una gráfica de barras que no responda a
 * nada. Todo lo que aparece sale de `GET /platform/overview` y de `GET /platform/access`, que
 * son las dos únicas cosas que la API sabe de la plataforma en su conjunto. Un panel con seis
 * gráficas de relleno enseña a no mirar el panel.
 *
 * ## Y lo que pide atención va arriba
 *
 * Los accesos vigentes a datos de clientes se enseñan ANTES que los totales. Los totales
 * cambian una vez al mes; un acceso abierto a los documentos de una empresa es lo que hay que
 * ver hoy y retirar cuando sobre. La jerarquía visual dice qué decisión ayuda a tomar cada
 * bloque.
 */
export function PlatformOverviewPage() {
  usePageTitle("platform.nav.overview");
  const t = useT();

  const overview = useResource<PlatformOverview>(
    useCallback(
      () =>
        api<PlatformOverview>("/platform/overview", {
          withoutOrganization: true,
        }),
      [],
    ),
  );

  const grants = useResource<MyGrant[]>(
    useCallback(
      () => api<MyGrant[]>("/platform/access", { withoutOrganization: true }),
      [],
    ),
  );

  const vigentes = (grants.data ?? []).filter((grant) => grant.usable);
  const pendientes = (grants.data ?? []).filter(
    (grant) => grant.status === "PENDING" && !grant.expired,
  );

  return (
    <>
      <PageHeader
        title={t("platform.overview.title")}
        description={t("platform.overview.subtitle")}
      />

      {/* Lo que está abierto AHORA, antes que cualquier total. */}
      <Section
        title={t("platform.overview.openAccess")}
        description={t("platform.overview.openAccessHint")}
        actions={
          <Link
            to="/platform/access"
            className="text-[12.5px] font-medium text-accent underline"
          >
            {t("platform.overview.seeAll")}
          </Link>
        }
      >
        <DataState
          loading={grants.loading}
          error={grants.error}
          empty={vigentes.length === 0 && pendientes.length === 0}
          emptyMessage={t("platform.overview.noOpenAccess")}
          onRetry={grants.reload}
        >
          <ul className="space-y-2">
            {vigentes.map((grant) => (
              <li
                key={grant.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]"
              >
                <StatusPill tone="positive">
                  {t(`platform.scope.${grant.scope}.name`)}
                </StatusPill>
                <span className="font-medium">{grant.organization.name}</span>
                <span className="text-muted">{grant.reason}</span>
              </li>
            ))}
            {pendientes.map((grant) => (
              <li
                key={grant.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]"
              >
                <StatusPill tone="attention">
                  {t("platform.grant.status.PENDING")}
                </StatusPill>
                <span className="font-medium">{grant.organization.name}</span>
                <span className="text-muted">
                  {t(`platform.scope.${grant.scope}.name`)}
                </span>
              </li>
            ))}
          </ul>
        </DataState>
      </Section>

      <div className="mt-6">
        <DataState
          loading={overview.loading}
          error={overview.error}
          onRetry={overview.reload}
        >
          {overview.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Metric
                  label={t("platform.overview.organizations")}
                  value={overview.data.totalOrganizations}
                />
                <Metric
                  label={t("platform.overview.people")}
                  value={overview.data.totalUsers}
                />
                <Metric
                  label={t("platform.overview.blocked")}
                  value={overview.data.bannedUsers}
                  hint={t("platform.overview.blockedHint")}
                  emptyHint={t("platform.overview.blockedHint")}
                />
              </div>

              <div className="mt-6">
                <Section title={t("platform.overview.byPlan")}>
                  <ul className="flex flex-wrap gap-x-8 gap-y-3">
                    {(["FREE", "PRO", "ENTERPRISE"] as const).map((plan) => (
                      <li key={plan}>
                        <p className="text-[12px] uppercase tracking-[0.06em] text-muted">
                          {t(`platform.plan.${plan}`)}
                        </p>
                        <p className="mt-0.5 text-[20px] font-semibold tabular-nums">
                          {overview.data?.organizationsByPlan[plan] ?? 0}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
            </>
          )}
        </DataState>
      </div>
    </>
  );
}
