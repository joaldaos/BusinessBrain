import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { useResource } from "../components/ui";
import { useT } from "../i18n";
import { useLabels } from "../i18n/labels";
import { ConfirmAction } from "./ConfirmAction";
import { Pagination } from "./OrganizationsPage";
import {
  ActionButton,
  Cell,
  DataState,
  DataTable,
  PageHeader,
  Row,
  Section,
  StatusPill,
  useDateFormat,
  usePageTitle,
} from "./ui";
import type { Paged, PlatformUser, PlatformUserDetail } from "./types";

/**
 * Las personas, desde la operación.
 *
 * ## Un aviso en la propia pantalla
 *
 * Abrir esto queda registrado, porque lo que se lee son nombres y correos de empleados de
 * empresas clientes. Se dice **en la pantalla**, no solo en la traza: quien mira debe saber
 * que mirar cuenta. Es la diferencia entre una auditoría que disuade y una que solo sirve para
 * el día después.
 */
export function PlatformUsersPage() {
  usePageTitle("platform.nav.users");
  const t = useT();
  const navigate = useNavigate();
  const { dateTime } = useDateFormat();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");

  const users = useResource<Paged<PlatformUser>>(
    useCallback(
      () =>
        api<Paged<PlatformUser>>(`/platform/users?page=${page}`, {
          withoutOrganization: true,
        }),
      [page],
    ),
    [page],
  );

  const visibles = useMemo(() => {
    const buscado = query.trim().toLowerCase();
    return (users.data?.items ?? []).filter(
      (user) =>
        buscado.length === 0 ||
        user.name.toLowerCase().includes(buscado) ||
        user.email.toLowerCase().includes(buscado),
    );
  }, [users.data, query]);

  return (
    <>
      <PageHeader
        title={t("platform.users.title")}
        description={t("platform.users.subtitle")}
      />

      <Section>
        <p className="mb-4 rounded border border-line bg-sunken px-3 py-2 text-[12.5px] text-muted">
          {t("platform.users.readLogged")}
        </p>

        <label className="mb-4 block max-w-sm">
          <span className="mb-1 block text-[12px] font-medium text-ink">
            {t("platform.users.search")}
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded border border-line bg-surface px-2.5 py-1.5 text-[13.5px] outline-none focus:border-accent"
          />
        </label>

        {query.trim().length > 0 && (users.data?.pages ?? 1) > 1 && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            {t("platform.organizations.searchScope")}
          </p>
        )}

        <DataState
          loading={users.loading}
          error={users.error}
          empty={visibles.length === 0}
          emptyMessage={t("platform.users.none")}
          onRetry={users.reload}
        >
          <DataTable
            head={[
              t("platform.users.column.name"),
              t("platform.users.column.email"),
              t("platform.users.column.state"),
              t("platform.users.column.mfa"),
              t("platform.users.column.lastSeen"),
            ]}
          >
            {visibles.map((user) => (
              <Row
                key={user.id}
                onOpen={() => navigate(`/platform/users/${user.id}`)}
              >
                <Cell>
                  <span className="font-medium">{user.name}</span>
                  {user.platformRole === "SUPERADMIN" && (
                    <StatusPill tone="neutral">
                      <span className="ml-2">
                        {t("platform.users.isAdmin")}
                      </span>
                    </StatusPill>
                  )}
                </Cell>
                <Cell muted>{user.email}</Cell>
                <Cell>
                  <StatusPill
                    tone={user.status === "BANNED" ? "danger" : "quiet"}
                  >
                    {t(`platform.users.status.${user.status}`)}
                  </StatusPill>
                </Cell>
                <Cell muted>
                  {t(
                    user.mfaEnabled
                      ? "platform.users.mfaOn"
                      : "platform.users.mfaOff",
                  )}
                </Cell>
                <Cell muted>{dateTime(user.lastActiveAt)}</Cell>
              </Row>
            ))}
          </DataTable>
        </DataState>

        {users.data && users.data.pages > 1 && (
          <Pagination
            page={users.data.page}
            pages={users.data.pages}
            onChange={setPage}
          />
        )}
      </Section>
    </>
  );
}

/**
 * La ficha de una persona, y las tres acciones que se pueden hacer sobre su cuenta.
 *
 * ## Ninguna de las tres ocurre por un clic
 *
 * Bloquear, desbloquear y retirar el segundo factor pasan por `ConfirmAction`: se explica qué
 * va a ocurrir, sobre quién, y —en la retirada del segundo factor— se exige el motivo que
 * quedará en la traza. La reautenticación es la del sistema.
 *
 * ## Y se dice lo que la retirada del segundo factor NO hace
 *
 * Es lo más cerca que la plataforma llega de la cuenta de alguien, y también lo que más fácil
 * es malinterpretar. La pantalla dice explícitamente que no da acceso: después sigue haciendo
 * falta la contraseña de esa persona.
 */
export function PlatformUserDetailPage() {
  const { userId = "" } = useParams();
  const t = useT();
  const labels = useLabels();
  const { user: actor } = useAuth();
  const { dateTime } = useDateFormat();

  const user = useResource<PlatformUserDetail>(
    useCallback(
      () =>
        api<PlatformUserDetail>(`/platform/users/${userId}`, {
          withoutOrganization: true,
        }),
      [userId],
    ),
    [userId],
  );

  const cambiarEstado = async (banned: boolean) => {
    await api(`/platform/users/${userId}/${banned ? "ban" : "unban"}`, {
      method: "POST",
      withoutOrganization: true,
    });
    user.reload();
  };

  const retirarMfa = async (reason: string) => {
    await api(`/platform/users/${userId}/mfa/remove`, {
      method: "POST",
      withoutOrganization: true,
      body: { reason },
    });
    user.reload();
  };

  const esUnoMismo = actor?.id === userId;
  const esDePlataforma = user.data?.platformRole === "SUPERADMIN";

  return (
    <>
      <Link
        to="/platform/users"
        className="mb-4 inline-block text-[12.5px] text-muted underline"
      >
        {t("platform.user.back")}
      </Link>

      <DataState
        loading={user.loading}
        error={user.error}
        onRetry={user.reload}
      >
        {user.data && (
          <>
            <PageHeader title={user.data.name} description={user.data.email} />

            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <Section title={t("platform.user.account")}>
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Field label={t("platform.users.column.state")}>
                    <StatusPill
                      tone={
                        user.data.status === "BANNED" ? "danger" : "positive"
                      }
                    >
                      {t(`platform.users.status.${user.data.status}`)}
                    </StatusPill>
                  </Field>
                  <Field label={t("platform.users.column.mfa")}>
                    {t(
                      user.data.mfaEnabled
                        ? "platform.users.mfaOn"
                        : "platform.users.mfaOff",
                    )}
                  </Field>
                  <Field label={t("platform.user.since")}>
                    {dateTime(user.data.createdAt)}
                  </Field>
                  <Field label={t("platform.users.column.lastSeen")}>
                    {dateTime(user.data.lastActiveAt)}
                  </Field>
                </dl>

                <h3 className="mt-6 mb-2 text-[12.5px] font-semibold">
                  {t("platform.user.organizations")}
                </h3>
                {user.data.organizations.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    {t(
                      esDePlataforma
                        ? "platform.user.noOrganizationsAdmin"
                        : "platform.user.noOrganizations",
                    )}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {user.data.organizations.map((org) => (
                      <li
                        key={org.id}
                        className="flex items-center gap-2 text-[13px]"
                      >
                        <Link
                          to={`/platform/organizations/${org.id}`}
                          className="font-medium underline"
                        >
                          {org.name}
                        </Link>
                        <span className="text-muted">
                          {labels.role(org.role)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section
                title={t("platform.user.actions")}
                description={t("platform.user.actionsHint")}
              >
                {esDePlataforma ? (
                  <p className="text-[13px] leading-relaxed text-muted">
                    {t("platform.user.cannotActOnAdmin")}
                  </p>
                ) : (
                  <div className="space-y-5">
                    <div>
                      {user.data.status === "BANNED" ? (
                        <ConfirmAction
                          trigger={(open) => (
                            <ActionButton onClick={open}>
                              {t("platform.user.unban")}
                            </ActionButton>
                          )}
                          title={t("platform.user.unbanTitle")}
                          subject={`${user.data.name} · ${user.data.email}`}
                          consequence={t("platform.user.unbanBody")}
                          confirmLabel={t("platform.user.unban")}
                          onConfirm={() => cambiarEstado(false)}
                        />
                      ) : (
                        <ConfirmAction
                          trigger={(open) => (
                            <ActionButton
                              variant="danger"
                              onClick={open}
                              disabled={esUnoMismo}
                            >
                              {t("platform.user.ban")}
                            </ActionButton>
                          )}
                          title={t("platform.user.banTitle")}
                          subject={`${user.data.name} · ${user.data.email}`}
                          consequence={t("platform.user.banBody")}
                          confirmLabel={t("platform.user.ban")}
                          variant="danger"
                          onConfirm={() => cambiarEstado(true)}
                        />
                      )}
                    </div>

                    {user.data.mfaEnabled && (
                      <div className="border-t border-line pt-5">
                        <ConfirmAction
                          trigger={(open) => (
                            <ActionButton variant="danger" onClick={open}>
                              {t("platform.user.removeMfa")}
                            </ActionButton>
                          )}
                          title={t("platform.user.removeMfaTitle")}
                          subject={`${user.data.name} · ${user.data.email}`}
                          consequence={t("platform.user.removeMfaBody")}
                          confirmLabel={t("platform.user.removeMfa")}
                          variant="danger"
                          requiresReason
                          reasonLabel={t("platform.user.removeMfaReason")}
                          reasonHint={t("platform.user.removeMfaReasonHint")}
                          onConfirm={retirarMfa}
                        />
                      </div>
                    )}
                  </div>
                )}
              </Section>
            </div>
          </>
        )}
      </DataState>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11.5px] uppercase tracking-[0.06em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-[13.5px]">{children}</dd>
    </div>
  );
}
