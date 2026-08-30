import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { Button, ErrorNote, Field, inputClass, useAction } from './ui';

/**
 * "Confirma que eres tú" antes de una acción delicada.
 *
 * ## Por qué pregunta el backend y no esto
 *
 * Esta pantalla NO decide si hace falta confirmar. Lo decide `RecentAuthGuard`, y esto se
 * limita a aparecer cuando la API responde que hace falta. Si decidiera aquí, bastaría con
 * abrir las herramientas del navegador para saltárselo — y el guard seguiría estando, pero
 * nadie sabría si de verdad funciona porque la interfaz nunca llegaría a probarlo.
 *
 * ## Qué credencial pide
 *
 * La que tenga la cuenta: el código si hay verificación en dos pasos, la contraseña si no. Lo
 * dice `GET /auth/me`, así que la pantalla no tiene que provocar un error primero para
 * averiguarlo. Quien manda la credencial equivocada recibe un no del servidor de todas formas.
 */
export function ReauthDialog({
  onDone,
  onCancel,
}: {
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const t = useT();
  const [value, setValue] = useState('');
  const action = useAction();
  const usesCode = user?.mfaEnabled ?? false;

  const submit = () =>
    void action.run(async () => {
      await api('/auth/reauthenticate', {
        method: 'POST',
        withoutOrganization: true,
        body: usesCode ? { code: value } : { password: value },
      });
      setValue('');
      await onDone();
    });

  /**
   * Esto NO es un `<form>`, y no es un descuido.
   *
   * El diálogo aparece dentro de la pantalla que provocó la acción, y algunas de esas
   * pantallas son formularios. Un `<form>` dentro de otro es HTML inválido: **el navegador
   * descarta el interno**, y entonces este botón pasa a enviar el formulario de fuera. El
   * efecto es exactísimamente el peor posible — la página se recarga, la reautenticación
   * nunca sale, y quien mira solo ve que no pasa nada.
   *
   * Ocurrió. Se detectó porque la prueba de navegador siguió el flujo completo; en las
   * pruebas HTTP todo estaba bien, porque ahí no hay formularios anidados que colapsar.
   */
  return (
    <div
      onKeyDown={(event) => {
        // Enter envía, que es lo que espera cualquiera al teclear un código de seis dígitos.
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      }}
      className="space-y-3 rounded-lg border border-attention/40 bg-attention-soft p-4"
    >
      <div>
        <h3 className="t-small font-semibold">{t('reauth.title')}</h3>
        <p className="mt-1 t-fine text-muted">{t('reauth.explain')}</p>
      </div>

      <Field label={usesCode ? t('reauth.code') : t('reauth.password')}>
        <input
          type={usesCode ? 'text' : 'password'}
          // `one-time-code` hace que el móvil ofrezca el código del SMS o del portapapeles, y
          // `current-password` que el gestor rellene la contraseña. Sin esto, la persona
          // teclea a mano justo en el momento en que menos paciencia tiene.
          autoComplete={usesCode ? 'one-time-code' : 'current-password'}
          inputMode={usesCode ? 'numeric' : undefined}
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          autoFocus
        />
      </Field>

      <ErrorNote error={action.error} />

      <div className="flex gap-2">
        {/* `type="button"`: si fuera `submit`, enviaría el formulario que lo rodea. */}
        <Button type="button" onClick={submit} disabled={action.busy}>
          {action.busy ? t('common.moment') : t('reauth.submit')}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="t-fine text-muted underline"
        >
          {t('reauth.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * Envuelve una acción sensible: si la API pide confirmar, enseña el diálogo y reintenta.
 *
 * Devuelve el diálogo cuando toca y `null` el resto del tiempo, para que cada pantalla decida
 * dónde ponerlo. Reintentar automáticamente después de confirmar es lo que evita que la
 * persona tenga que acordarse de volver a pulsar el botón que ya pulsó.
 */
export function useSensitiveAction() {
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);

  const run = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      // 403 es la respuesta de `RecentAuthGuard`. Cualquier otro error sube: un "no eres
      // propietario" no se arregla confirmando la identidad, y enseñar el diálogo ahí sería
      // pedirle a alguien que demuestre quién es para algo que no va a poder hacer igualmente.
      if (
        error instanceof Error &&
        'status' in error &&
        (error as { status: number }).status === 403
      ) {
        setPending(() => () => operation());
        return;
      }
      throw error;
    }
  };

  const dialog = pending ? (
    <ReauthDialog
      onDone={async () => {
        // El reintento va ANTES de cerrar el diálogo. Al revés, un fallo del reintento se
        // perdería: quien lo captura es el `useAction` del propio diálogo, y si ya se ha
        // desmontado, el error no tiene dónde aparecer. La persona vería el formulario
        // volver a su sitio sin que hubiera pasado nada y sin saber por qué.
        await pending();
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { run, dialog };
}
