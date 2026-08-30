import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useResource } from "../components/ui";
import { useT } from "../i18n";
import { ConfirmAction } from "./ConfirmAction";
import { ScopeContent, ScopePanel } from "./ScopePanel";
import {
  ActionButton,
  Cell,
  DataState,
  DataTable,
  Metric,
  PageHeader,
  Row,
  Section,
  StatusPill,
  useDateFormat,
  usePageTitle,
} from "./ui";
import type {
  Grant,
  OrganizationDiagnostics,
  OrganizationDocument,
  OrganizationDocumentDetail,
  OrganizationInspection,
  PlanTier,
  PlatformOrganization,
} from "./types";

/**
 * Una empresa cliente, vista desde la operación.
 *
 * ## La pantalla está partida en dos mitades que no se tocan
 *
 * Arriba, **la relación**: nombre, plan, cuánta gente, desde cuándo. Se ve siempre, porque es
 * nuestra cartera de clientes.
 *
 * Abajo, **su negocio**: tres paneles, uno por alcance, cada uno cerrado hasta que exista una
 * concesión suya. Entre las dos mitades hay una separación explícita con un rótulo que dice qué
 * empieza ahí. No es adorno: es lo que hace que nadie confunda "sé que este cliente tiene 400
 * documentos" con "puedo leerlos".
 */
export function PlatformOrganizationDetailPage() {
  usePageTitle("platform.nav.organizations");
  const { organizationId = "" } = useParams();
  const t = useT();
  const { date } = useDateFormat();

  const organization = useResource<PlatformOrganization>(
    useCallback(
      () =>
        api<PlatformOrganization>(`/platform/organizations/${organizationId}`, {
          withoutOrganization: true,
        }),
      [organizationId],
    ),
    [organizationId],
  );

  const grants = useResource<Grant[]>(
    useCallback(
      () =>
        api<Grant[]>(`/platform/organizations/${organizationId}/access`, {
          withoutOrganization: true,
        }),
      [organizationId],
    ),
    [organizationId],
  );

  /** La concesión VIGENTE de un alcance, o la que está esperando aprobación. */
  const grantFor = (scope: Grant["scope"]) =>
    (grants.data ?? [])
      .filter((grant) => grant.scope === scope)
      .find(
        (grant) =>
          grant.usable || (grant.status === "PENDING" && !grant.expired),
      );

  const recargar = () => {
    grants.reload();
    organization.reload();
  };

  return (
    <>
      <Link
        to="/platform/organizations"
        className="mb-4 inline-block text-[12.5px] text-muted underline"
      >
        {t("platform.organization.back")}
      </Link>

      <DataState
        loading={organization.loading}
        error={organization.error}
        onRetry={organization.reload}
      >
        {organization.data && (
          <>
            <PageHeader
              title={organization.data.name}
              description={t("platform.organization.subtitle", {
                slug: organization.data.slug,
              })}
              actions={
                <ChangePlan
                  organizationId={organizationId}
                  organizationName={organization.data.name}
                  current={organization.data.planTier}
                  onChanged={recargar}
                />
              }
            />

            {/* ── La relación ─────────────────────────────────────────── */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label={t("platform.organization.plan")}
                value={t(`platform.plan.${organization.data.planTier}`)}
              />
              <Metric
                label={t("platform.organizations.column.people")}
                value={organization.data._count.memberships}
              />
              <Metric
                label={t("platform.organizations.column.documents")}
                value={organization.data._count.knowledgeItems}
              />
              <Metric
                label={t("platform.organization.since")}
                value={date(organization.data.createdAt)}
              />
            </div>

            {/* ── La frontera, dicha en voz alta ──────────────────────── */}
            <div className="mt-10 mb-5 border-t border-line pt-5">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                {t("platform.organization.theirData")}
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
                {t("platform.organization.theirDataHint")}
              </p>
            </div>

            <DataState
              loading={grants.loading}
              error={grants.error}
              onRetry={grants.reload}
            >
              <div className="space-y-4">
                <ScopePanel
                  organizationId={organizationId}
                  organizationName={organization.data.name}
                  scope="METADATA"
                  grant={grantFor("METADATA")}
                  onChanged={recargar}
                >
                  <Metadata organizationId={organizationId} />
                </ScopePanel>

                <ScopePanel
                  organizationId={organizationId}
                  organizationName={organization.data.name}
                  scope="DIAGNOSTICS"
                  grant={grantFor("DIAGNOSTICS")}
                  onChanged={recargar}
                >
                  <Diagnostics organizationId={organizationId} />
                </ScopePanel>

                <ScopePanel
                  organizationId={organizationId}
                  organizationName={organization.data.name}
                  scope="CONTENT"
                  grant={grantFor("CONTENT")}
                  onChanged={recargar}
                >
                  <Documents organizationId={organizationId} />
                </ScopePanel>
              </div>

              <div className="mt-6">
                <GrantHistory grants={grants.data ?? []} />
              </div>
            </DataState>
          </>
        )}
      </DataState>
    </>
  );
}

// ── METADATA ─────────────────────────────────────────────────────────────────

function Metadata({ organizationId }: { organizationId: string }) {
  const t = useT();
  const { dateTime } = useDateFormat();

  return (
    <ScopeContent
      enabled
      load={useCallback(
        () =>
          api<OrganizationInspection>(
            `/platform/organizations/${organizationId}/overview`,
            { withoutOrganization: true },
          ),
        [organizationId],
      )}
    >
      {(data) => (
        <>
          <ul className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
            {(
              [
                ["miembros", "platform.organizations.column.people"],
                ["documentos", "platform.organizations.column.documents"],
                ["colecciones", "platform.metadata.collections"],
                ["conclusiones", "platform.metadata.insights"],
              ] as const
            ).map(([clave, etiqueta]) => (
              <li key={clave}>
                <p className="text-[12px] uppercase tracking-[0.06em] text-muted">
                  {t(etiqueta)}
                </p>
                <p className="mt-0.5 text-[18px] font-semibold tabular-nums">
                  {data.counts[clave]}
                </p>
              </li>
            ))}
          </ul>

          {data.sources.length > 0 && (
            <DataTable
              head={[
                t("platform.metadata.source"),
                t("platform.metadata.state"),
                t("platform.metadata.lastSync"),
              ]}
            >
              {data.sources.map((source) => (
                <Row key={source.id}>
                  <Cell>{source.name}</Cell>
                  <Cell>
                    <StatusPill
                      tone={source.status === "ERROR" ? "danger" : "quiet"}
                    >
                      {source.status}
                    </StatusPill>
                  </Cell>
                  <Cell muted>{dateTime(source.lastSyncedAt)}</Cell>
                </Row>
              ))}
            </DataTable>
          )}
        </>
      )}
    </ScopeContent>
  );
}

// ── DIAGNOSTICS ──────────────────────────────────────────────────────────────

function Diagnostics({ organizationId }: { organizationId: string }) {
  const t = useT();
  const { dateTime } = useDateFormat();

  return (
    <ScopeContent
      enabled
      load={useCallback(
        () =>
          api<OrganizationDiagnostics>(
            `/platform/organizations/${organizationId}/diagnostics`,
            { withoutOrganization: true },
          ),
        [organizationId],
      )}
      empty={(data) =>
        data.failingSources.length === 0 &&
        data.recentJobs.length === 0 &&
        data.failedAnalyses.length === 0
      }
    >
      {(data) => (
        <div className="space-y-5">
          {data.failingSources.length > 0 && (
            <div>
              <h4 className="mb-2 text-[12.5px] font-semibold">
                {t("platform.diagnostics.failingSources")}
              </h4>
              <ul className="space-y-2">
                {data.failingSources.map((source) => (
                  <li
                    key={source.id}
                    className="rounded border border-red-200 bg-red-50/50 px-3 py-2"
                  >
                    <p className="text-[13px] font-medium">{source.name}</p>
                    {/*
                      El mensaje de error se muestra TAL CUAL. Es evidencia técnica: si se
                      tradujera o se resumiera, dejaría de servir para diagnosticar, que es lo
                      único para lo que existe este alcance.
                    */}
                    <p className="mt-0.5 font-mono text-[12px] text-red-900">
                      {source.lastError}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {dateTime(source.lastSyncedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.recentJobs.length > 0 && (
            <div>
              <h4 className="mb-2 text-[12.5px] font-semibold">
                {t("platform.diagnostics.recentJobs")}
              </h4>
              <DataTable
                head={[
                  t("platform.diagnostics.state"),
                  t("platform.diagnostics.detail"),
                  t("platform.diagnostics.when"),
                ]}
              >
                {data.recentJobs.map((job) => (
                  <Row key={job.id}>
                    <Cell>
                      <StatusPill
                        tone={job.status === "FAILED" ? "danger" : "quiet"}
                      >
                        {job.status}
                      </StatusPill>
                    </Cell>
                    <Cell muted>
                      <span className="font-mono text-[12px]">
                        {job.error ?? "—"}
                      </span>
                    </Cell>
                    <Cell muted>{dateTime(job.startedAt)}</Cell>
                  </Row>
                ))}
              </DataTable>
            </div>
          )}

          {data.failedAnalyses.length > 0 && (
            <div>
              <h4 className="mb-2 text-[12.5px] font-semibold">
                {t("platform.diagnostics.failedAnalyses")}
              </h4>
              <ul className="space-y-1.5">
                {data.failedAnalyses.map((run) => (
                  <li key={run.id} className="text-[12.5px]">
                    <span className="font-mono text-red-900">{run.error}</span>
                    <span className="ml-2 text-muted">
                      {dateTime(run.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </ScopeContent>
  );
}

// ── CONTENT ──────────────────────────────────────────────────────────────────

/**
 * Los documentos de la empresa.
 *
 * El texto se pide de UNO EN UNO, y esto lo respeta: hay que abrir cada documento
 * explícitamente. No es una limitación de la interfaz, es que cada apertura deja una entrada
 * en la traza diciendo cuál se leyó — y el cliente puede verla. Un botón de "abrir todos"
 * dejaría una sola entrada que dice "se abrió la lista".
 */
function Documents({ organizationId }: { organizationId: string }) {
  const t = useT();
  const { dateTime } = useDateFormat();
  const [abierto, setAbierto] = useState<OrganizationDocumentDetail | null>(
    null,
  );
  const [cargando, setCargando] = useState<string | null>(null);

  const abrir = async (id: string) => {
    setCargando(id);
    try {
      setAbierto(
        await api<OrganizationDocumentDetail>(
          `/platform/organizations/${organizationId}/documents/${id}`,
          { withoutOrganization: true },
        ),
      );
    } finally {
      setCargando(null);
    }
  };

  return (
    <ScopeContent
      enabled
      load={useCallback(
        () =>
          api<OrganizationDocument[]>(
            `/platform/organizations/${organizationId}/documents`,
            { withoutOrganization: true },
          ),
        [organizationId],
      )}
      empty={(data) => data.length === 0}
    >
      {(documents) => (
        <>
          <DataTable
            head={[
              t("platform.content.title"),
              t("platform.content.state"),
              t("platform.content.indexed"),
              "",
            ]}
          >
            {documents.map((document) => (
              <Row key={document.id}>
                <Cell>{document.title}</Cell>
                <Cell>
                  <StatusPill tone="quiet">{document.status}</StatusPill>
                </Cell>
                <Cell muted>{dateTime(document.indexedAt)}</Cell>
                <Cell>
                  <ActionButton
                    variant="danger"
                    disabled={cargando === document.id}
                    onClick={() => void abrir(document.id)}
                  >
                    {cargando === document.id
                      ? t("common.moment")
                      : t("platform.content.read")}
                  </ActionButton>
                </Cell>
              </Row>
            ))}
          </DataTable>

          {abierto && (
            <div className="mt-4 rounded-lg border border-red-200 bg-surface p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <h4 className="text-[13.5px] font-semibold">{abierto.title}</h4>
                <button
                  type="button"
                  onClick={() => setAbierto(null)}
                  className="text-[12.5px] text-muted underline"
                >
                  {t("platform.content.close")}
                </button>
              </div>
              <p className="mb-2 text-[11.5px] text-muted">
                {t("platform.content.readLogged")}
              </p>
              {/*
                El documento se enseña TAL CUAL, sin traducir ni resumir: es evidencia del
                cliente y cualquier transformación lo dejaría de ser.
              */}
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-sunken p-3 font-mono text-[12.5px] leading-relaxed">
                {abierto.contentText}
              </pre>
            </div>
          )}
        </>
      )}
    </ScopeContent>
  );
}

// ── Historial de accesos ─────────────────────────────────────────────────────

function GrantHistory({ grants }: { grants: Grant[] }) {
  const t = useT();
  const { dateTime } = useDateFormat();

  return (
    <Section
      title={t("platform.grantHistory.title")}
      description={t("platform.grantHistory.hint")}
    >
      <DataState
        loading={false}
        error={null}
        empty={grants.length === 0}
        emptyMessage={t("platform.grantHistory.none")}
      >
        <DataTable
          head={[
            t("platform.grantHistory.scope"),
            t("platform.grantHistory.state"),
            t("platform.grantHistory.reason"),
            t("platform.grantHistory.requestedBy"),
            t("platform.grantHistory.requestedAt"),
            t("platform.grantHistory.expires"),
          ]}
        >
          {grants.map((grant) => (
            <Row key={grant.id}>
              <Cell>{t(`platform.scope.${grant.scope}.name`)}</Cell>
              <Cell>
                <StatusPill
                  tone={
                    grant.usable
                      ? "positive"
                      : grant.status === "PENDING" && !grant.expired
                        ? "attention"
                        : "quiet"
                  }
                >
                  {grant.status === "REVOKED"
                    ? t("platform.grant.status.REVOKED")
                    : grant.expired
                      ? t("platform.grant.status.EXPIRED")
                      : t(`platform.grant.status.${grant.status}`)}
                </StatusPill>
              </Cell>
              <Cell muted>{grant.reason}</Cell>
              <Cell>{grant.requestedBy.name}</Cell>
              <Cell muted>{dateTime(grant.createdAt)}</Cell>
              <Cell muted>{dateTime(grant.expiresAt)}</Cell>
            </Row>
          ))}
        </DataTable>
      </DataState>
    </Section>
  );
}

// ── Cambio de plan ───────────────────────────────────────────────────────────

/**
 * Cambiar el plan de una empresa.
 *
 * No dice qué incluye cada plan: el backend no lo sabe todavía y **inventarlo aquí sería
 * escribir en la pantalla de quien decide una información que no existe en ninguna parte**.
 * Lo que sí dice es exactamente qué va a cambiar: de este plan a este otro, en esta empresa.
 */
function ChangePlan({
  organizationId,
  organizationName,
  current,
  onChanged,
}: {
  organizationId: string;
  organizationName: string;
  current: PlanTier;
  onChanged: () => void;
}) {
  const t = useT();
  const [target, setTarget] = useState<PlanTier>(current);

  const cambiar = async () => {
    await api(`/platform/organizations/${organizationId}/plan`, {
      method: "POST",
      withoutOrganization: true,
      body: { planTier: target },
    });
    onChanged();
  };

  return (
    <div className="text-right">
      <label className="mb-1 block text-[12px] font-medium text-ink">
        {t("platform.plan.change")}
      </label>
      <div className="flex items-center gap-2">
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value as PlanTier)}
          className="rounded border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        >
          {(["FREE", "PRO", "ENTERPRISE"] as const).map((plan) => (
            <option key={plan} value={plan}>
              {t(`platform.plan.${plan}`)}
            </option>
          ))}
        </select>

        <ConfirmAction
          trigger={(open) => (
            <ActionButton
              variant="primary"
              disabled={target === current}
              onClick={open}
            >
              {t("platform.plan.apply")}
            </ActionButton>
          )}
          title={t("platform.plan.confirmTitle")}
          subject={organizationName}
          consequence={t("platform.plan.confirmBody", {
            from: t(`platform.plan.${current}`),
            to: t(`platform.plan.${target}`),
          })}
          confirmLabel={t("platform.plan.apply")}
          variant="primary"
          onConfirm={cambiar}
        />
      </div>
    </div>
  );
}
