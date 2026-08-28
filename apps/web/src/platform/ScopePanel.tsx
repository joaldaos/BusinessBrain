import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { ConfirmAction } from './ConfirmAction';
import {
  ActionButton,
  DataState,
  Section,
  StatusPill,
  useDateFormat,
  useRelativeDeadline,
} from './ui';
import type { Grant, GrantScope } from './types';

/**
 * Un alcance de acceso a una empresa: qué permite, si está abierto y cómo se pide.
 *
 * ## Los tres se pintan por separado, y esa es la garantía
 *
 * No hay un panel de "acceso" con tres casillas. Hay tres paneles, cada uno con su estado, su
 * caducidad y su botón. Es la forma visual de una regla del backend: los alcances son
 * independientes y ninguno arrastra a otro. Un panel único con casillas invitaría a pedir los
 * tres de una vez «ya que estoy», que es exactamente el hábito que la separación existe para
 * evitar.
 *
 * ## Y CONTENT no se pide como los otros dos
 *
 * Metadatos y diagnóstico se abren al pedirlos: son operación. El contenido queda PENDIENTE
 * hasta que el propietario de la empresa lo apruebe, y aquí se dice antes de pulsar, no
 * después. Su tarjeta lleva además el peso visual de lo que es: leer lo que esa empresa
 * escribió.
 */
export function ScopePanel({
  organizationId,
  organizationName,
  scope,
  grant,
  onChanged,
  children,
}: {
  organizationId: string;
  organizationName: string;
  scope: GrantScope;
  /** La concesión vigente de ESTE alcance, si la hay. */
  grant: Grant | undefined;
  onChanged: () => void;
  /** Lo que se ve cuando el acceso está abierto. */
  children: React.ReactNode;
}) {
  const t = useT();
  const { user } = useAuth();
  const { dateTime } = useDateFormat();
  const restante = useRelativeDeadline();

  const abierto = grant?.usable ?? false;
  const pendiente = grant?.status === 'PENDING' && !grant.expired;
  const esContenido = scope === 'CONTENT';

  const pedir = async (reason: string) => {
    await api(`/platform/organizations/${organizationId}/access`, {
      method: 'POST',
      withoutOrganization: true,
      body: { scope, reason },
    });
    onChanged();
  };

  const retirar = async () => {
    if (!grant) return;
    await api(
      `/platform/organizations/${organizationId}/access/${grant.id}/revoke`,
      { method: 'POST', withoutOrganization: true },
    );
    onChanged();
  };

  return (
    <Section
      title={t(`platform.scope.${scope}.name`)}
      description={t(`platform.scope.${scope}.explains`)}
      actions={
        abierto ? (
          <StatusPill tone="active">{t('platform.scope.open')}</StatusPill>
        ) : pendiente ? (
          <StatusPill tone="attention">
            {t('platform.scope.awaitingOwner')}
          </StatusPill>
        ) : (
          <StatusPill tone="quiet">{t('platform.scope.closed')}</StatusPill>
        )
      }
    >
      {abierto && grant && (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            <span>
              {t('platform.scope.expires', { when: restante(grant.expiresAt) })}
            </span>
            <span aria-hidden>·</span>
            <span>{dateTime(grant.expiresAt)}</span>
            <span aria-hidden>·</span>
            <span>{t('platform.scope.reasonGiven', { reason: grant.reason })}</span>
          </p>

          <div className="mb-4">{children}</div>

          <ConfirmAction
            trigger={(open) => (
              <ActionButton onClick={open}>
                {t('platform.scope.revoke')}
              </ActionButton>
            )}
            title={t('platform.scope.revokeTitle')}
            subject={organizationName}
            consequence={t('platform.scope.revokeConsequence', {
              scope: t(`platform.scope.${scope}.name`),
            })}
            confirmLabel={t('platform.scope.revoke')}
            onConfirm={retirar}
          />
        </>
      )}

      {pendiente && grant && (
        <p className="text-[13px] leading-relaxed text-ink/80">
          {t('platform.scope.pendingExplain', {
            organization: organizationName,
          })}
          <span className="mt-1 block text-[12.5px] text-muted">
            {t('platform.scope.pendingExpires', {
              when: restante(grant.expiresAt),
            })}
          </span>
        </p>
      )}

      {!abierto && !pendiente && (
        <ConfirmAction
          trigger={(open) => (
            <ActionButton
              variant={esContenido ? 'grave' : 'default'}
              onClick={open}
            >
              {t(`platform.scope.${scope}.request`)}
            </ActionButton>
          )}
          title={t(`platform.scope.${scope}.confirmTitle`)}
          subject={organizationName}
          /*
            Las cuatro preguntas que pediste que respondiera antes de pedir contenido: qué se
            va a poder consultar, por qué (el motivo lo escribe quien pide), durante cuánto
            tiempo, y quién lo está solicitando.
          */
          consequence={t(`platform.scope.${scope}.confirmBody`, {
            who: user?.name ?? '',
          })}
          confirmLabel={t(`platform.scope.${scope}.request`)}
          variant={esContenido ? 'grave' : 'primary'}
          requiresReason
          reasonLabel={t('platform.scope.reasonLabel')}
          reasonHint={t('platform.scope.reasonHint')}
          onConfirm={pedir}
        />
      )}
    </Section>
  );
}

/**
 * Lo que se ve dentro de un alcance abierto.
 *
 * Se carga SOLO cuando el acceso está abierto: llamar de todas formas y esconder el 403 haría
 * que la pantalla generase entradas de auditoría de accesos denegados cada vez que alguien
 * abre una ficha. La traza dejaría de significar nada.
 */
export function ScopeContent<T>({
  enabled,
  load,
  children,
  empty,
}: {
  enabled: boolean;
  load: () => Promise<T>;
  children: (data: T) => React.ReactNode;
  empty?: (data: T) => boolean;
}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let vivo = true;
    setLoading(true);
    setError(null);
    load()
      .then((resultado) => {
        if (vivo) setData(resultado);
      })
      .catch((caught: unknown) => {
        // Un 403 aquí solo puede significar que la concesión caducó entre que se pintó la
        // pantalla y que se pidió el dato. Se trata como error normal: la pantalla lo dice y
        // ofrece recargar, en vez de fingir que no hay datos.
        if (vivo) setError(caught);
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });

    return () => {
      vivo = false;
    };
  }, [enabled, load, intento]);

  return (
    <DataState
      loading={loading}
      error={error}
      empty={data !== null && (empty?.(data) ?? false)}
      onRetry={() => setIntento((n) => n + 1)}
    >
      {data !== null && children(data)}
    </DataState>
  );
}
