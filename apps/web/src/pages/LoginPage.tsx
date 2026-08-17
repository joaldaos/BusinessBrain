import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field, inputClass, useAction } from '../components/ui';

/**
 * Entrar, crear cuenta y ACEPTAR una invitación.
 *
 * La invitación llega como `?invitacion=<token>` porque no hay envío de correo: el enlace se
 * copia y se pega. Se acepta DESPUÉS de autenticarse, que es el único momento en que el
 * servidor puede comprobar que quien acepta es la persona invitada — el backend exige que el
 * correo coincida, así que reenviar el enlace a un tercero no le da acceso.
 *
 * Si la aceptación falla —caducada, ya usada, o de otro correo— la sesión NO se rompe: se entra
 * igualmente y se explica. Dejar a alguien fuera de su cuenta por una invitación vieja sería
 * peor que el problema que resuelve.
 */
export function LoginPage() {
  const { user, loading, login, register, refreshUser } = useAuth();
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

  if (loading) return <p className="p-8 text-sm text-gray-500">Cargando…</p>;
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
          error instanceof Error
            ? error.message
            : 'No se pudo aceptar la invitación',
        );
      }
    }
  });

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">BusinessBrain</h1>
        <p className="mt-1 text-sm text-gray-600">
          La capa de inteligencia de tu empresa.
        </p>
        {invitation && (
          <p className="mt-2 text-sm text-blue-800">
            Te han invitado a una empresa en BusinessBrain. Entra o crea tu cuenta
            con el correo al que te invitaron y quedarás dentro.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {mode === 'register' && (
          <Field label="Nombre">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
        )}

        <Field label="Correo">
          <input
            type="email"
            autoComplete="username"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Contraseña">
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
            Has entrado, pero la invitación no se pudo aceptar: {invitationError}
          </p>
        )}

        <Button type="submit" disabled={action.busy} className="w-full">
          {action.busy
            ? 'Un momento…'
            : mode === 'login'
              ? 'Entrar'
              : 'Crear cuenta'}
        </Button>

        <button
          type="button"
          className="w-full text-center text-xs text-gray-500 underline"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login'
            ? '¿No tienes cuenta? Crear una'
            : 'Ya tengo cuenta'}
        </button>
      </form>
    </main>
  );
}
