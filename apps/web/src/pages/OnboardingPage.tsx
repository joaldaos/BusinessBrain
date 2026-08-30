import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { Organization } from '../api/types';
import { Button, ErrorNote, Field, inputClass, useAction } from '../components/ui';
import { useT } from '../i18n';

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
  const t = useT();
  const [name, setName] = useState('');
  const action = useAction();

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold tracking-tight">
        {t('onboarding.title')}
      </h1>
      <p className="mt-2 t-small text-muted">
        {/* Dos frases y no una con un trozo pegado delante: en otro idioma el nombre puede no
            ir al principio, y una frase partida por concatenación no se puede traducir bien. */}
        {user?.name
          ? t('onboarding.introNamed', { name: user.name })
          : t('onboarding.intro')}
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
          label={t('onboarding.companyName')}
          hint={t('onboarding.companyHint')}
        >
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('onboarding.companyPlaceholder')}
            minLength={2}
            required
            autoFocus
          />
        </Field>

        <ErrorNote error={action.error} />

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={action.busy}>
            {action.busy ? t('onboarding.creating') : t('onboarding.create')}
          </Button>
          <Button variant="secondary" onClick={logout}>
            {t('shell.logout')}
          </Button>
        </div>
      </form>

      <p className="mt-6 t-fine text-muted">
        {t('onboarding.alreadyInside')}
      </p>
    </main>
  );
}
