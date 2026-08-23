import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Button, ErrorNote, Field, inputClass, useAction } from '../components/ui';

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
        <h1 className="text-xl font-semibold tracking-tight">BusinessBrain</h1>
      </div>
      {children}
    </main>
  );
}

export function PasswordRecoveryPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const action = useAction();

  if (enviado) {
    return (
      <Marco>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <p className="font-medium">Mira tu correo.</p>
          <p className="mt-2 text-gray-600">
            Si hay una cuenta con esa dirección, acabas de recibir un enlace para
            elegir una contraseña nueva. Caduca en una hora.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            ¿No te ha llegado? Comprueba la carpeta de correo no deseado, o
            revisa si la dirección era otra.
          </p>
          <Link
            className="mt-3 inline-block text-xs text-blue-700 underline"
            to="/login"
          >
            Volver a la entrada
          </Link>
        </div>
      </Marco>
    );
  }

  return (
    <Marco>
      <form
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
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
          <p className="text-sm font-medium">¿Has olvidado tu contraseña?</p>
          <p className="mt-1 text-xs text-gray-600">
            Escribe tu correo y te mandamos un enlace para elegir una nueva.
          </p>
        </div>

        <Field label="Correo">
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
          {action.busy ? 'Enviando…' : 'Enviarme el enlace'}
        </Button>

        <Link
          className="block text-center text-xs text-gray-500 underline"
          to="/login"
        >
          Volver a la entrada
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
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <p className="font-medium">Este enlace está incompleto.</p>
          <p className="mt-2 text-gray-600">
            Copia el enlace entero desde el correo, o pide uno nuevo.
          </p>
          <Link
            className="mt-3 inline-block text-xs text-blue-700 underline"
            to="/recuperar"
          >
            Pedir un enlace nuevo
          </Link>
        </div>
      </Marco>
    );
  }

  if (listo) {
    return (
      <Marco>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <p className="font-medium">Ya tienes contraseña nueva.</p>
          <p className="mt-2 text-gray-600">
            Por seguridad hemos cerrado las sesiones que estuvieran abiertas en
            otros dispositivos.
          </p>
          <Link
            className="mt-3 inline-block text-blue-700 underline"
            to="/login"
          >
            Entrar
          </Link>
        </div>
      </Marco>
    );
  }

  return (
    <Marco>
      <form
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
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
        <p className="text-sm font-medium">Elige tu contraseña nueva</p>

        <Field label="Contraseña" hint="Al menos 8 caracteres.">
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

        <Field label="Repítela">
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
          <p className="text-xs text-amber-700">
            Las dos contraseñas no son iguales.
          </p>
        )}
        <ErrorNote error={action.error} />

        <Button type="submit" disabled={action.busy} className="w-full">
          {action.busy ? 'Guardando…' : 'Guardar y entrar'}
        </Button>
      </form>
    </Marco>
  );
}
