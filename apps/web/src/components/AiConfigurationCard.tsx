import { useState } from 'react';
import { api } from '../api/client';
import type { AiConfiguration, AiProviderOption } from '../api/types';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  inputClass,
  useAction,
  useResource,
} from './ui';

/**
 * La inteligencia artificial de la empresa.
 *
 * ## Por qué esto es una tarjeta y no un ajuste escondido
 *
 * Sin IA configurada, BusinessBrain no puede leer los documentos que suba la empresa ni
 * responder preguntas: no es una preferencia, es el interruptor del producto. Por eso se
 * enseña el estado siempre —también a quien no puede cambiarlo— porque explica por qué una
 * pregunta no encuentra nada.
 *
 * ## La clave se escribe y no vuelve
 *
 * El servidor no la devuelve nunca, ni enmascarada, así que aquí no hay forma de "ver la clave
 * actual": solo de sustituirla. Es deliberado — una clave de un proveedor de modelos es gasto
 * directo de la empresa, y devolverla para rellenar un formulario la pondría al alcance de
 * cualquier script de la página.
 */
export function AiConfigurationCard({
  canAdmin,
  onChanged,
}: {
  canAdmin: boolean;
  onChanged?: () => void;
}) {
  const status = useResource(() => api<AiConfiguration>('/ai-configuration'));
  const providers = useResource(() =>
    api<AiProviderOption[]>('/ai-configuration/providers'),
  );

  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const action = useAction();

  const options = providers.data ?? [];
  const chosen = options.find((option) => option.provider === provider) ?? options[0];

  return (
    <Card title="Inteligencia artificial">
      <ErrorNote error={status.error ?? action.error} />

      {status.data && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={status.data.ready ? 'good' : 'bad'}>
            {status.data.ready ? 'lista' : 'sin configurar'}
          </Badge>
          {status.data.modelName && (
            <span className="text-xs text-gray-600">{status.data.modelName}</span>
          )}
          <p className="w-full text-xs text-gray-600">{status.data.explanation}</p>
        </div>
      )}

      {!canAdmin && (
        <p className="text-xs text-gray-500">
          Solo un administrador puede cambiar esta configuración.
        </p>
      )}

      {canAdmin && (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3"
          onSubmit={action.onSubmit(async () => {
            await api('/ai-configuration', {
              method: 'POST',
              body: {
                provider: chosen?.provider,
                apiKey: apiKey.trim(),
              },
            });
            // La clave desaparece del formulario en cuanto se guarda: no tiene por qué
            // seguir en memoria de la página.
            setApiKey('');
            status.reload();
            onChanged?.();
          })}
        >
          {options.length > 1 && (
            <div className="min-w-40">
              <Field label="Proveedor">
                <select
                  aria-label="Proveedor"
                  className={inputClass}
                  value={chosen?.provider ?? ''}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  {options.map((option) => (
                    <option key={option.provider} value={option.provider}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <div className="min-w-64 flex-1">
            <Field
              label={
                status.data?.hasOwnKey
                  ? 'Sustituir la clave'
                  : `Clave de ${chosen?.label ?? 'tu proveedor'}`
              }
              hint={
                chosen
                  ? `Empieza por "${chosen.keyPrefixHint}". La comprobamos antes de guardarla y no se muestra nunca más.`
                  : undefined
              }
            >
              <input
                type="password"
                autoComplete="off"
                className={inputClass}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={chosen ? `${chosen.keyPrefixHint}…` : ''}
                required
              />
            </Field>
          </div>

          <Button type="submit" disabled={action.busy || !chosen}>
            {action.busy ? 'Comprobando…' : 'Guardar y comprobar'}
          </Button>

          {status.data?.hasOwnKey && (
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() =>
                void action
                  .run(() => api('/ai-configuration', { method: 'DELETE' }))
                  .then(() => {
                    status.reload();
                    onChanged?.();
                  })
              }
            >
              Quitar mi clave
            </Button>
          )}
        </form>
      )}

      {canAdmin && chosen && (
        <p className="mt-2 text-xs text-gray-500">
          ¿No tienes clave?{' '}
          <a
            className="underline"
            href={chosen.helpUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Créala en tu cuenta de {chosen.label}
          </a>
          . El consumo se factura en tu cuenta, no en BusinessBrain.
        </p>
      )}
    </Card>
  );
}
