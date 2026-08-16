import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field, inputClass, useAction } from '../components/ui';

export function LoginPage() {
  const { user, loading, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const action = useAction();

  if (loading) return <p className="p-8 text-sm text-gray-500">Cargando…</p>;
  if (user) return <Navigate to="/" replace />;

  const submit = action.onSubmit(() =>
    mode === 'login'
      ? login(email, password)
      : register({ email, password, name }),
  );

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">BusinessBrain</h1>
        <p className="mt-1 text-sm text-gray-600">
          La capa de inteligencia de tu empresa.
        </p>
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
