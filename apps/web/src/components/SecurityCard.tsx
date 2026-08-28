import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  inputClass,
  useAction,
  useFormatDate,
  useResource,
} from './ui';
import { useSensitiveAction } from './ReauthDialog';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  pendingConfirmation: boolean;
  remainingRecoveryCodes: number;
}

interface Enrollment {
  qrDataUrl: string;
  manualKey: string;
}

/**
 * La seguridad de la cuenta: verificación en dos pasos y contraseña.
 *
 * ## El vocabulario
 *
 * Aquí no aparece "TOTP", ni "secreto", ni "recovery code", ni el nombre de ninguna constante.
 * Quien lee esto lleva una asesoría o un taller: "un código que cambia cada pocos segundos en
 * tu móvil" describe lo mismo y se entiende sin haber leído un RFC.
 *
 * ## Los códigos de repuesto se enseñan una vez y punto
 *
 * Viven en el estado de este componente y desaparecen al cerrarlo. No hay ninguna ruta que los
 * devuelva —de ellos solo queda su huella en el servidor— así que si la persona cierra la
 * pestaña sin guardarlos, se generan otros. Es incómodo a propósito: el texto lo dice antes.
 */
export function SecurityCard() {
  const { user, refreshUser } = useAuth();
  const t = useT();
  const formatDate = useFormatDate();

  const status = useResource<MfaStatus>(
    useCallback(() => api<MfaStatus>('/auth/mfa', { withoutOrganization: true }), []),
  );
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const sensitive = useSensitiveAction();

  const startEnrollment = useAction();
  const confirmEnrollment = useAction();
  const otherAction = useAction();

  const reload = async () => {
    status.reload();
    // El estado de la sesión cambia: `mfaEnabled` decide qué credencial pide el diálogo de
    // confirmación. Sin releerlo, la próxima acción sensible pediría la contraseña a alguien
    // que acaba de activar la verificación.
    await refreshUser();
  };

  const begin = () =>
    void startEnrollment.run(async () => {
      setEnrollment(
        await api<Enrollment>('/auth/mfa/setup', {
          method: 'POST',
          withoutOrganization: true,
        }),
      );
    });

  const confirm = confirmEnrollment.onSubmit(async () => {
    const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
      method: 'POST',
      withoutOrganization: true,
      body: { code },
    });
    setEnrollment(null);
    setCode('');
    setFreshCodes(result.recoveryCodes);
    await reload();
  });

  const disable = () =>
    void otherAction.run(async () => {
      await sensitive.run(async () => {
        await api('/auth/mfa/disable', {
          method: 'POST',
          withoutOrganization: true,
        });
        await reload();
      });
    });

  const regenerate = () =>
    void otherAction.run(async () => {
      await sensitive.run(async () => {
        const result = await api<{ recoveryCodes: string[] }>(
          '/auth/mfa/recovery-codes',
          { method: 'POST', withoutOrganization: true },
        );
        setFreshCodes(result.recoveryCodes);
        await reload();
      });
    });

  if (!user) return null;

  return (
    <div className="space-y-4">
      <Card title={t('mfa.title')}>
        <p className="text-sm text-gray-600">{t('mfa.explain')}</p>

        {status.data && (
          <p className="mt-3 text-sm">
            <strong>
              {status.data.enabled ? t('mfa.status.on') : t('mfa.status.off')}
            </strong>
            {status.data.enabled && status.data.enabledAt && (
              <span className="ml-2 text-gray-500">
                {t('mfa.status.since', {
                  date: formatDate(status.data.enabledAt),
                })}
              </span>
            )}
          </p>
        )}

        {status.data?.pendingConfirmation && !enrollment && (
          <p className="mt-2 text-xs text-amber-700">
            {t('mfa.status.pending')}
          </p>
        )}

        {status.data?.enabled && (
          <p className="mt-1 text-xs text-gray-500">
            {t(
              status.data.remainingRecoveryCodes <= 3
                ? 'mfa.status.lowCodes'
                : 'mfa.status.remaining',
              { count: status.data.remainingRecoveryCodes },
            )}
          </p>
        )}

        {/* ── Alta: el QR y el primer código ── */}
        {enrollment && (
          <form onSubmit={confirm} className="mt-4 space-y-3 border-t pt-4">
            <p className="text-sm text-gray-700">{t('mfa.setup.step1')}</p>
            <img
              src={enrollment.qrDataUrl}
              alt={t('mfa.setup.qrAlt')}
              className="rounded border border-gray-200"
              width={200}
              height={200}
            />
            <p className="text-xs text-gray-500">
              {t('mfa.setup.manual')}{' '}
              <code className="rounded bg-gray-100 px-1 font-mono">
                {enrollment.manualKey}
              </code>
            </p>

            <Field label={t('mfa.setup.code')}>
              <input
                className={inputClass}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </Field>

            <ErrorNote error={confirmEnrollment.error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={confirmEnrollment.busy}>
                {confirmEnrollment.busy
                  ? t('common.moment')
                  : t('mfa.setup.confirm')}
              </Button>
              <button
                type="button"
                className="text-xs text-gray-500 underline"
                onClick={() => setEnrollment(null)}
              >
                {t('mfa.setup.cancel')}
              </button>
            </div>
          </form>
        )}

        {/* ── Los códigos de repuesto. Una vez. ── */}
        {freshCodes && (
          <div className="mt-4 space-y-2 rounded border border-blue-300 bg-blue-50 p-3">
            <h4 className="text-sm font-semibold">{t('mfa.codes.title')}</h4>
            <p className="text-xs text-gray-700">{t('mfa.codes.explain')}</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {freshCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button onClick={() => setFreshCodes(null)}>
              {t('mfa.codes.understood')}
            </Button>
          </div>
        )}

        {sensitive.dialog && <div className="mt-4">{sensitive.dialog}</div>}
        <ErrorNote error={startEnrollment.error ?? otherAction.error} />

        <div className="mt-4 flex flex-wrap gap-2">
          {!status.data?.enabled && !enrollment && (
            <Button onClick={begin} disabled={startEnrollment.busy}>
              {t('mfa.activate')}
            </Button>
          )}
          {status.data?.enabled && (
            <>
              <Button onClick={regenerate} disabled={otherAction.busy}>
                {t('mfa.codes.regenerate')}
              </Button>
              <button
                type="button"
                onClick={disable}
                disabled={otherAction.busy}
                className="text-xs text-gray-500 underline"
              >
                {t('mfa.deactivate')}
              </button>
            </>
          )}
        </div>
        {status.data?.enabled && (
          <p className="mt-1 text-xs text-gray-500">
            {t('mfa.codes.regenerateHint')}
          </p>
        )}
      </Card>

      <PasswordCard />
    </div>
  );
}

/**
 * Cambiar la contraseña desde dentro.
 *
 * No pide la actual: la ruta exige haber confirmado la identidad hace menos de quince minutos,
 * y para quien no tiene verificación en dos pasos esa confirmación ES la contraseña actual.
 * Pedirla dos veces sería pedir lo mismo dos veces.
 */
function PasswordCard() {
  const t = useT();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const action = useAction();
  const sensitive = useSensitiveAction();

  const submit = action.onSubmit(async () => {
    if (password !== repeat) throw new Error(t('password.mismatch'));

    await sensitive.run(async () => {
      await api('/auth/password', {
        method: 'POST',
        withoutOrganization: true,
        body: { newPassword: password },
      });
      setPassword('');
      setRepeat('');
      setDone(true);
    });
  });

  return (
    <Card title={t('password.title')}>
      <p className="text-sm text-gray-600">{t('password.explain')}</p>

      <form onSubmit={submit} className="mt-3 space-y-3">
        <Field label={t('password.new')}>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </Field>
        <Field label={t('password.repeat')}>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
          />
        </Field>

        <ErrorNote error={action.error} />
        {done && <p className="text-xs text-green-700">{t('password.done')}</p>}
        {sensitive.dialog}

        <Button type="submit" disabled={action.busy}>
          {action.busy ? t('common.moment') : t('password.submit')}
        </Button>
      </form>
    </Card>
  );
}
