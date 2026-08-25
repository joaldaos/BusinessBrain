import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field, inputClass, useAction } from '../components/ui';
import { useT } from '../i18n';
import { LanguagePicker } from '../components/LanguagePicker';

/**
 * Entrar, crear cuenta y ACEPTAR una invitación.
 *
 * La invitación llega como `?invitacion=<token>` porque el correo solo se usa hoy para
 * recuperar la contraseña: el enlace se copia y se pega. Se acepta DESPUÉS de autenticarse,
 * que es el único momento en que el servidor puede comprobar que quien acepta es la persona
 * invitada — el backend exige que el correo coincida, así que reenviar el enlace a un tercero
 * no le da acceso.
 *
 * Si la aceptación falla —caducada, ya usada, o de otro correo— la sesión NO se rompe: se entra
 * igualmente y se explica. Dejar a alguien fuera de su cuenta por una invitación vieja sería
 * peor que el problema que resuelve.
 *
 * ## Por qué el selector de idioma está aquí
 *
 * Es la primera pantalla que ve nadie, y la única a la que se llega sin haber entrado. Si el
 * idioma solo se pudiera cambiar en Configuración, alguien cuyo navegador está en un idioma
 * que no entiende tendría que atravesar el registro a ciegas para poder cambiarlo.
 */
export function LoginPage() {
  const { user, loading, login, register, refreshUser } = useAuth();
  const t = useT();
  const [params] = useSearchParams();
  const invitation = params.get('invitacion');
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>(
    // Con una invitación en la mano, lo normal es que la persona todavía no tenga cuenta.
    invitation ? 'register' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const action = useAction();

  if (loading) return <p className="p-8 text-sm text-gray-500">{t('common.loading')}</p>;
  // `!action.busy` no es cosmético: al entrar con invitación, la sesión queda lista ANTES de
  // aceptarla, y navegar en ese instante llevaría a la pantalla de "crea tu empresa" a alguien
  // que acaba de ser invitado a una. Se retiene aquí hasta que el turno entero termina.
  if (user && !action.busy) return <Navigate to="/" replace />;

  const submit = action.onSubmit(async () => {
    if (mode === 'login') await login(email, password);
    else await register({ email, password, name });

    if (invitation) {
      try {
        await api(`/invitations/${invitation}/accept`, {
          method: 'POST',
          withoutOrganization: true,
        });
        // La membresía es nueva: sin releer la sesión, la interfaz no sabría que ya
        // pertenece a esa empresa y le ofreceria crear otra.
        await refreshUser();
      } catch (error) {
        setInvitationError(
          error instanceof Error ? error.message : t('common.retry'),
        );
      }
    }
  });

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">BusinessBrain</h1>
        <p className="mt-1 text-sm text-gray-600">{t('login.tagline')}</p>
        {invitation && (
          <p className="mt-2 text-sm text-blue-800">{t('login.invited')}</p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {mode === 'register' && (
          <Field label={t('login.name')}>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
        )}

        <Field label={t('login.email')}>
          <input
            type="email"
            autoComplete="username"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label={t('login.password')}>
          <input
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        <ErrorNote error={action.error} />
        {invitationError && (
          <p className="text-xs text-amber-700">
            {t('login.invitationFailed', { reason: invitationError })}
          </p>
        )}

        <Button type="submit" disabled={action.busy} className="w-full">
          {action.busy
            ? t('common.moment')
            : mode === 'login'
              ? t('login.signIn')
              : t('login.createAccount')}
        </Button>

        <button
          type="button"
          className="w-full text-center text-xs text-gray-500 underline"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? t('login.toRegister') : t('login.toLogin')}
        </button>

        {/* Solo al entrar: ofrecérselo a quien está creando una cuenta no tiene sentido. */}
        {mode === 'login' && (
          <Link
            to="/recuperar"
            className="block text-center text-xs text-gray-500 underline"
          >
            {t('login.forgot')}
          </Link>
        )}
      </form>

      <LanguagePicker />
    </main>
  );
}
