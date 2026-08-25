import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  inputClass,
  useAction,
  useResource,
} from './ui';
import { useT, type TranslationKey } from '../i18n';

/**
 * Qué sabemos de esta empresa, cómo se lo lleva y cómo lo borra.
 *
 * ## Por qué está aquí y no en un enlace a un texto legal
 *
 * Una asesoría o una clínica preguntan esto en la primera reunión: dónde va el texto de mis
 * contratos. Remitirles a un documento en otra página es la respuesta de alguien que preferiría
 * no darla. Está en la misma pantalla donde se configura la IA porque es la misma decisión.
 *
 * ## El servidor declara QUÉ sale; esta pantalla lo dice en el idioma de quien mira
 *
 * La lista de salidas no está escrita aquí: la declara el backend, donde una prueba estructural
 * comprueba que no hay ninguna llamada al modelo sin declarar. Lo que sí está aquí es la
 * traducción, porque el servidor no puede saber en qué idioma se le habla a esta persona.
 *
 * Si alguna vez llegara una salida sin traducir —porque se añadió una y nadie tradujo el
 * texto— se muestra la frase que manda el servidor. Un aviso en otro idioma es feo; un aviso
 * incompleto sería falso.
 */
interface PrivacyNotice {
  aiProvider: { callSite: string; code: string; what: string; trigger: string }[];
  stored: { code: string; what: string; detail: string }[];
  pending: { code: string; text: string }[];
}

export function PrivacyCard({
  organizationId,
  organizationName,
  isOwner,
}: {
  organizationId: string | null;
  organizationName: string | null;
  isOwner: boolean;
}) {
  const t = useT();
  const notice = useResource(() => api<PrivacyNotice>('/privacy/notice'));

  /** Traduce por código, y si no hay traducción usa lo que mandó el servidor. */
  const traducir = (clave: string, respaldo: string) => {
    const texto = t(clave as TranslationKey);
    return texto === clave ? respaldo : texto;
  };

  return (
    <Card title={t('privacy.title')}>
      <ErrorNote error={notice.error} />

      {notice.data && (
        <>
          <section className="mb-4">
            <p className="text-sm font-medium">{t('privacy.outgoing.title')}</p>
            <p className="mt-1 text-xs text-gray-600">
              {t('privacy.outgoing.explain')}
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-700">
              {notice.data.aiProvider.map((flujo) => (
                <li key={flujo.callSite} className="flex gap-2">
                  <span aria-hidden className="text-gray-400">
                    →
                  </span>
                  <span>
                    {traducir(`privacy.flow.${flujo.code}.what`, flujo.what)}{' '}
                    <span className="text-gray-500">
                      {traducir(
                        `privacy.flow.${flujo.code}.trigger`,
                        flujo.trigger,
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mb-4">
            <p className="text-sm font-medium">{t('privacy.stored.title')}</p>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-700">
              {notice.data.stored.map((dato) => (
                <li key={dato.code}>
                  <span className="font-medium">
                    {traducir(`privacy.stored.${dato.code}.what`, dato.what)}.
                  </span>{' '}
                  <span className="text-gray-600">
                    {traducir(
                      `privacy.stored.${dato.code}.detail`,
                      dato.detail,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Lo que todavía no está resuelto se dice. Un cliente que pregunta por el contrato
              de encargado de tratamiento y recibe silencio se lleva peor impresión que uno
              que recibe "todavía no, y lo sabemos". */}
          <section className="mb-4 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">
              {t('privacy.pending.title')}
            </p>
            <ul className="mt-1 space-y-1 text-xs text-amber-900">
              {notice.data.pending.map((punto) => (
                <li key={punto.code}>
                  {traducir(`privacy.pending.${punto.code}`, punto.text)}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {isOwner && (
        <>
          <ExportSection
            organizationId={organizationId}
            organizationName={organizationName}
          />
          <EraseSection
            organizationId={organizationId}
            organizationName={organizationName}
          />
        </>
      )}
    </Card>
  );
}

/** Llevarse una copia. Solo el propietario: ver el servicio en el backend. */
function ExportSection({
  organizationId,
  organizationName,
}: {
  organizationId: string | null;
  organizationName: string | null;
}) {
  const t = useT();
  const action = useAction();

  return (
    <section className="mb-4 border-t border-gray-100 pt-3">
      <p className="text-sm font-medium">{t('privacy.export.title')}</p>
      <p className="mt-1 text-xs text-gray-600">{t('privacy.export.explain')}</p>

      <ErrorNote error={action.error} />

      <Button
        className="mt-2"
        variant="secondary"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const copia = await api<unknown>(
              `/organizations/${organizationId}/export`,
            );

            // Se compone el fichero en el navegador: la API ya devuelve el contenido y
            // añadir una segunda ruta solo para ponerle nombre no aporta nada.
            const enlace = document.createElement('a');
            enlace.href = URL.createObjectURL(
              new Blob([JSON.stringify(copia, null, 2)], {
                type: 'application/json',
              }),
            );
            enlace.download = `businessbrain-${organizationName ?? 'empresa'}.json`;
            enlace.click();
            URL.revokeObjectURL(enlace.href);
          })
        }
      >
        {action.busy ? t('privacy.export.busy') : t('privacy.export.button')}
      </Button>
    </section>
  );
}

/**
 * Borrar la empresa.
 *
 * Hay que teclear el nombre. Es irreversible y no hay papelera: sin esa fricción, el botón
 * está a un despiste de distancia. El servidor lo exige igualmente — esto no es la
 * comprobación, es la advertencia.
 */
function EraseSection({
  organizationId,
  organizationName,
}: {
  organizationId: string | null;
  organizationName: string | null;
}) {
  const t = useT();
  const { logout } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const action = useAction();

  return (
    <section className="border-t border-gray-100 pt-3">
      <p className="text-sm font-medium text-red-800">
        {t('privacy.erase.title')}
      </p>
      <p className="mt-1 text-xs text-gray-600">{t('privacy.erase.explain')}</p>

      {!abierto ? (
        <Button
          className="mt-2"
          variant="danger"
          onClick={() => setAbierto(true)}
        >
          {t('privacy.erase.open')}
        </Button>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={action.onSubmit(async () => {
            await api(`/organizations/${organizationId}/erase`, {
              method: 'POST',
              body: { confirmationName: nombre },
            });
            // Ya no hay empresa a la que volver: se cierra la sesión en vez de dejar la
            // interfaz apuntando a algo que ha dejado de existir.
            logout();
          })}
        >
          <Field
            label={t('privacy.erase.confirmLabel', {
              name: organizationName ?? '',
            })}
            hint={t('privacy.erase.confirmHint')}
          >
            <input
              className={inputClass}
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              required
            />
          </Field>

          <ErrorNote error={action.error} />

          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={action.busy}>
              {action.busy
                ? t('privacy.erase.busy')
                : t('privacy.erase.submit')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAbierto(false);
                setNombre('');
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
