import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Button, ErrorNote, Field, inputClass, useAction } from '../components/ui';
import { LanguagePicker } from '../components/LanguagePicker';
import { useT } from '../i18n';

/**
 * Volver a entrar cuando se ha olvidado la contraseña.
 *
 * Son dos pantallas de un mismo camino y viven juntas por eso: pedir el enlace y usarlo. La
 * alternativa era que un cliente que perdía su contraseña se quedara fuera hasta que alguien
 * entrara a mano en la base de datos, que es exactamente el tipo de rescate que un producto
 * que se vende no puede necesitar.
 *
 * ## Por qué no se dice si el correo existe
 *
 * Ni aquí ni en el servidor. Si esta pantalla respondiera "no hay ninguna cuenta con ese
 * correo", cualquiera podría probar direcciones y quedarse con las que existen — para una PYME,
 * su lista de empleados o de clientes. El mensaje es el mismo en los dos casos, y está escrito
 * para que eso no parezca un fallo: dice qué hacer si el correo no llega.
 */
function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-6">
      <div>
        <h1 className="t-display text-ink">BusinessBrain</h1>
      </div>
      {children}
      {/* También aquí: se llega sin haber entrado, y quien no entiende la pantalla necesita
          poder cambiarla. */}
      <LanguagePicker />
    </main>
  );
}

export function PasswordRecoveryPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const action = useAction();

  if (enviado) {
    return (
      <Marco>
        <div className="rounded-lg border border-line bg-surface p-4 t-small">
          <p className="font-medium">{t('recovery.sentTitle')}</p>
          <p className="mt-2 text-muted">{t('recovery.sentBody')}</p>
          <p className="mt-2 t-fine text-muted">{t('recovery.sentHint')}</p>
          <Link
            className="mt-3 inline-block t-fine text-accent underline"
            to="/login"
          >
            {t('recovery.backToLogin')}
          </Link>
        </div>
      </Marco>
    );
  }

  return (
    <Marco>
      <form
        className="space-y-3 rounded-lg border border-line bg-surface p-4"
        onSubmit={action.onSubmit(async () => {
          await api('/auth/password-reset/request', {
            method: 'POST',
            withoutOrganization: true,
            body: { email: email.trim() },
          });
          setEnviado(true);
        })}
      >
        <div>
          <p className="t-small font-medium">{t('recovery.title')}</p>
          <p className="mt-1 t-fine text-muted">{t('recovery.explain')}</p>
        </div>

        <Field label={t('login.email')}>
          <input
            type="email"
            autoComplete="username"
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <ErrorNote error={action.error} />

        <Button type="submit" disabled={action.busy} className="w-full">
          {action.busy ? t('recovery.sending') : t('recovery.submit')}
        </Button>

        <Link
          className="block text-center t-fine text-muted underline"
          to="/login"
        >
          {t('recovery.backToLogin')}
        </Link>
      </form>
    </Marco>
  );
}

/**
 * Elegir la contraseña nueva.
 *
 * No inicia sesión sola al terminar: se manda a la persona a entrar con lo que acaba de
 * escribir. Además de ser la comprobación de que se guardó bien, es lo que hace que la
 * contraseña nueva se le quede — una sesión regalada aquí y mañana no se acuerda.
 */
export function PasswordResetPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [listo, setListo] = useState(false);
  const [noCoincide, setNoCoincide] = useState(false);
  const action = useAction();

  if (!token) {
    return (
      <Marco>
        <div className="rounded-lg border border-line bg-surface p-4 t-small">
          <p className="font-medium">{t('recovery.incompleteTitle')}</p>
          <p className="mt-2 text-muted">{t('recovery.incompleteBody')}</p>
          <Link
            className="mt-3 inline-block t-fine text-accent underline"
            to="/recuperar"
          >
            {t('recovery.askNew')}
          </Link>
        </div>
      </Marco>
    );
  }

  if (listo) {
    return (
      <Marco>
        <div className="rounded-lg border border-line bg-surface p-4 t-small">
          <p className="font-medium">{t('recovery.doneTitle')}</p>
          <p className="mt-2 text-muted">{t('recovery.doneBody')}</p>
          <Link className="mt-3 inline-block text-accent underline" to="/login">
            {t('login.signIn')}
          </Link>
        </div>
      </Marco>
    );
  }

  return (
    <Marco>
      <form
        className="space-y-3 rounded-lg border border-line bg-surface p-4"
        onSubmit={action.onSubmit(async () => {
          // Se comprueba antes de llamar: que el servidor rechace una contraseña por no
          // coincidir con otra que no conoce sería imposible, y equivocarse al teclear una
          // contraseña que no se ve es lo más normal del mundo.
          if (password !== repetida) {
            setNoCoincide(true);
            return;
          }
          setNoCoincide(false);

          await api('/auth/password-reset/confirm', {
            method: 'POST',
            withoutOrganization: true,
            body: { token, password },
          });
          setListo(true);
        })}
      >
        <p className="t-small font-medium">{t('recovery.chooseTitle')}</p>

        <Field label={t('login.password')} hint={t('recovery.passwordHint')}>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
          />
        </Field>

        <Field label={t('recovery.repeat')}>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={repetida}
            onChange={(event) => setRepetida(event.target.value)}
            required
          />
        </Field>

        {noCoincide && (
          <p className="t-fine text-attention">{t('recovery.mismatch')}</p>
        )}
        <ErrorNote error={action.error} />

        <Button type="submit" disabled={action.busy} className="w-full">
          {action.busy ? t('common.saving') : t('recovery.submitNew')}
        </Button>
      </form>
    </Marco>
  );
}
