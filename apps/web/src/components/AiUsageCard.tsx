import { useState } from 'react';
import { api } from '../api/client';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  inputClass,
  useAction,
  useResource,
} from './ui';
import { useT } from '../i18n';

interface AiUsage {
  used: number;
  limit: number;
}

/**
 * Cuánto ha gastado hoy la empresa en IA, y su tope.
 *
 * ## Por qué esto se enseña y no se esconde
 *
 * El tope existe para que un cliente no se lleve un susto con SU factura: la clave del
 * proveedor es suya y el cargo le llega a él. Un límite que frena sin avisar ni dejarse ver es
 * indistinguible de una avería — alguien sube su carpeta entera, deja de funcionar a media
 * tarde y no entiende nada.
 *
 * Se muestra a cualquier miembro, aunque solo un administrador pueda cambiarlo: quien recibe
 * "has llegado al máximo de hoy" tiene derecho a ver cuánto era el máximo.
 *
 * ## Por qué se habla de páginas y no de caracteres
 *
 * Por dentro se cuentan caracteres, que es lo único que se sabe con certeza en el momento de
 * llamar al modelo. "Dos mil páginas" es lo que una persona puede comparar con su realidad;
 * "cinco millones de caracteres" no significa nada para nadie.
 */
const CARACTERES_POR_PAGINA = 2_500;

const enPaginas = (caracteres: number) =>
  Math.round(caracteres / CARACTERES_POR_PAGINA);

export function AiUsageCard({
  canAdmin,
  organizationId,
}: {
  canAdmin: boolean;
  organizationId: string | null;
}) {
  const t = useT();
  const usage = useResource(() => api<AiUsage>('/ai-configuration/usage'));
  const [paginas, setPaginas] = useState('');
  const [guardado, setGuardado] = useState(false);
  const action = useAction();

  const usado = usage.data?.used ?? 0;
  const techo = usage.data?.limit ?? 0;
  const proporcion = techo > 0 ? Math.min(usado / techo, 1) : 0;

  return (
    <Card title={t('aiUsage.title')}>
      <ErrorNote error={usage.error ?? action.error} />

      {usage.data && (
        <>
          <div
            className="h-2 w-full overflow-hidden rounded bg-gray-100"
            role="progressbar"
            aria-valuenow={Math.round(proporcion * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('aiUsage.label')}
          >
            <div
              className={`h-full ${proporcion >= 1 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${proporcion * 100}%` }}
            />
          </div>

          <p className="mt-2 text-xs text-gray-600">
            {t('aiUsage.summary', {
              used: enPaginas(usado),
              limit: enPaginas(techo),
            })}
          </p>

          {proporcion >= 1 && (
            <p className="mt-1 text-xs text-red-700">{t('aiUsage.reached')}</p>
          )}
        </>
      )}

      {canAdmin && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3"
          onSubmit={action.onSubmit(async () => {
            await api(`/organizations/${organizationId}`, {
              method: 'PATCH',
              body: {
                settings: {
                  ai: {
                    dailyCharacterLimit:
                      Number(paginas) * CARACTERES_POR_PAGINA,
                  },
                },
              },
            });
            setGuardado(true);
            usage.reload();
          })}
        >
          <div className="min-w-44">
            <Field label={t('aiUsage.limit')} hint={t('aiUsage.limitHint')}>
              <input
                type="number"
                min="1"
                className={inputClass}
                value={paginas}
                onChange={(event) => {
                  setPaginas(event.target.value);
                  setGuardado(false);
                }}
                placeholder={String(enPaginas(techo))}
                required
              />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={action.busy}>
            {t('aiUsage.save')}
          </Button>
          {guardado && (
            <span className="text-xs text-green-700">{t('aiUsage.saved')}</span>
          )}
        </form>
      )}
    </Card>
  );
}
