import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { Organization } from '../api/types';
import { Button, ErrorNote, Field, inputClass, useAction } from '../components/ui';

/**
 * Crear la empresa: el primer paso real de una PYME dentro de BusinessBrain.
 *
 * Hasta aquí, quien se registraba llegaba a una pantalla que le decía que creara su
 * organización "desde la API". Registrarse funcionaba, entrar funcionaba, y a partir de ahí no
 * había producto: nada de lo construido —conocimiento, comprensión, informes— es alcanzable sin
 * una organización, porque casi toda la API la resuelve desde la cabecera `x-org-id`.
 *
 * No es una pantalla de configuración: es la puerta. Por eso se muestra sola, sin navegación
 * alrededor, y explica qué es una organización en lugar de pedir un dato sin contexto.
 */
export function OnboardingPage() {
  const { user, refreshUser, selectOrganization, logout } = useAuth();
  const [name, setName] = useState('');
  const action = useAction();

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold tracking-tight">
        Bienvenido a BusinessBrain
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        {user?.name ? `${user.name}, ` : ''}lo primero es dar de alta tu empresa.
        Todo lo que BusinessBrain aprenda —documentos, correo, conclusiones— vivirá
        dentro de ella y no se mezclará nunca con la de nadie más.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={action.onSubmit(async () => {
          const created = await api<Organization>('/organizations', {
            method: 'POST',
            body: { name: name.trim() },
            // Todavía no hay organización activa: es justo la que se está creando.
            withoutOrganization: true,
          });
          // Se activa la recién creada y se recarga la sesión: quien la crea queda OWNER, y
          // sin releer las membresías la interfaz seguiría sin saberlo.
          selectOrganization(created.id);
          await refreshUser();
        })}
      >
        <Field
          label="Nombre de tu empresa"
          hint="Podrás cambiarlo después en Configuración."
        >
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Panadería Ruiz S.L."
            minLength={2}
            required
            autoFocus
          />
        </Field>

        <ErrorNote error={action.error} />

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={action.busy}>
            {action.busy ? 'Creando…' : 'Crear mi empresa'}
          </Button>
          <Button variant="secondary" onClick={logout}>
            Salir
          </Button>
        </div>
      </form>

      <p className="mt-6 text-xs text-gray-500">
        Si alguien de tu empresa ya usa BusinessBrain, pídele que te invite en vez
        de crear una segunda: así compartiréis el mismo conocimiento.
      </p>
    </main>
  );
}
