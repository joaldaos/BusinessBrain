import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useResource } from '../components/ui';
import { useT } from '../i18n';
import { ConfirmAction } from './ConfirmAction';
import {
  ActionButton,
  DataState,
  PageHeader,
  Section,
  StatusPill,
  useDateFormat,
  useRelativeDeadline,
} from './ui';
import type { MyGrant } from './types';

/**
 * "¿Qué tengo abierto ahora mismo?"
 *
 * ## Es la pantalla que hace que los accesos se cierren
 *
 * Sin ella, saber qué accesos siguen vivos exigiría recorrer las empresas una por una — que en
 * la práctica significa no mirarlo nunca, y que las concesiones se queden abiertas hasta que
 * caducan solas. Aquí se ven todas de golpe, y retirar una es un gesto.
 *
 * Lo vigente va primero y lo terminado debajo, apagado. El historial importa —es lo que se
 * mira al reconstruir qué pasó— pero no compite por la atención con lo que está abierto ahora.
 *
 * ## Y una advertencia que la pantalla dice en voz alta
 *
 * Tener una concesión NO es pertenecer a esa empresa. Es la confusión más fácil de cometer
 * mirando esta lista, porque se parece a una lista de "mis organizaciones" — y no lo es: son
 * permisos temporales de lectura sobre datos ajenos.
 */
export function PlatformMyAccessPage() {
  const t = useT();
  const { dateTime } = useDateFormat();
  const restante = useRelativeDeadline();

  const grants = useResource<MyGrant[]>(
    useCallback(
      () => api<MyGrant[]>('/platform/access', { withoutOrganization: true }),
      [],
    ),
  );

  const vigentes = (grants.data ?? []).filter(
    (grant) => grant.usable || (grant.status === 'PENDING' && !grant.expired),
  );
  const terminadas = (grants.data ?? []).filter(
    (grant) => !vigentes.includes(grant),
  );

  const revocar = async (grant: MyGrant) => {
    await api(
      `/platform/organizations/${grant.organizationId}/access/${grant.id}/revoke`,
      { method: 'POST', withoutOrganization: true },
    );
    grants.reload();
  };

  return (
    <>
      <PageHeader
        title={t('platform.myAccess.title')}
        description={t('platform.myAccess.subtitle')}
      />

      <p className="mb-5 rounded border border-line bg-white px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        {t('platform.myAccess.notMembership')}
      </p>

      <Section title={t('platform.myAccess.open')}>
        <DataState
          loading={grants.loading}
          error={grants.error}
          empty={vigentes.length === 0}
          emptyMessage={t('platform.myAccess.noneOpen')}
          onRetry={grants.reload}
        >
          <ul className="space-y-3">
            {vigentes.map((grant) => (
              <li
                key={grant.id}
                className="rounded border border-line px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    to={`/platform/organizations/${grant.organization.id}`}
                    className="text-[14px] font-medium underline"
                  >
                    {grant.organization.name}
                  </Link>
                  <StatusPill tone={grant.usable ? 'active' : 'attention'}>
                    {t(`platform.scope.${grant.scope}.name`)}
                  </StatusPill>
                  {!grant.usable && (
                    <span className="text-[12.5px] text-amber-800">
                      {t('platform.scope.awaitingOwner')}
                    </span>
                  )}
                  <span className="ml-auto text-[12.5px] text-muted">
                    {t('platform.myAccess.expires', {
                      when: restante(grant.expiresAt),
                    })}
                  </span>
                </div>

                <p className="mt-1.5 text-[12.5px] text-muted">
                  {t('platform.scope.reasonGiven', { reason: grant.reason })}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  {t('platform.myAccess.requestedAt', {
                    when: dateTime(grant.createdAt),
                  })}
                  {grant.approvedBy &&
                    ` · ${t('platform.myAccess.approvedBy', {
                      who: grant.approvedBy.name,
                    })}`}
                </p>

                <div className="mt-3">
                  <ConfirmAction
                    trigger={(open) => (
                      <ActionButton onClick={open}>
                        {t('platform.scope.revoke')}
                      </ActionButton>
                    )}
                    title={t('platform.scope.revokeTitle')}
                    subject={grant.organization.name}
                    consequence={t('platform.scope.revokeConsequence', {
                      scope: t(`platform.scope.${grant.scope}.name`),
                    })}
                    confirmLabel={t('platform.scope.revoke')}
                    onConfirm={() => revocar(grant)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </DataState>
      </Section>

      {terminadas.length > 0 && (
        <div className="mt-6">
          <Section
            title={t('platform.myAccess.finished')}
            description={t('platform.myAccess.finishedHint')}
          >
            <ul className="space-y-2">
              {terminadas.map((grant) => (
                <li
                  key={grant.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-muted"
                >
                  <span className="text-ink/70">
                    {grant.organization.name}
                  </span>
                  <StatusPill tone="quiet">
                    {t(`platform.scope.${grant.scope}.name`)}
                  </StatusPill>
                  <span>
                    {grant.status === 'REVOKED'
                      ? t('platform.grant.status.REVOKED')
                      : t('platform.grant.status.EXPIRED')}
                  </span>
                  <span className="ml-auto text-[12px]">
                    {dateTime(grant.revokedAt ?? grant.expiresAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </>
  );
}
