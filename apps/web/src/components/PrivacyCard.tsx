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

/**
 * Qué sabemos de esta empresa, cómo se lo lleva y cómo lo borra.
 *
 * ## Por qué está aquí y no en un enlace a un texto legal
 *
 * Una asesoría o una clínica preguntan esto en la primera reunión: dónde va el texto de mis
 * contratos. Remitirles a un documento en otra página es la respuesta de alguien que preferiría
 * no darla. Está en la misma pantalla donde se configura la IA porque es la misma decisión.
 *
 * ## El aviso lo redacta el servidor
 *
 * La lista de qué sale hacia el proveedor no está escrita aquí: la sirve el backend, donde una
 * prueba estructural comprueba que no hay ninguna llamada al modelo sin declarar. Escribirla en
 * esta pantalla habría bastado hoy y se habría quedado corta en cuanto alguien añadiera una
 * función — y un aviso de privacidad desactualizado afirma algo falso.
 */
interface PrivacyNotice {
  aiProvider: { callSite: string; what: string; trigger: string }[];
  stored: { what: string; detail: string }[];
  pending: string[];
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
  const notice = useResource(() => api<PrivacyNotice>('/privacy/notice'));

  return (
    <Card title="Tus datos y la inteligencia artificial">
      <ErrorNote error={notice.error} />

      {notice.data && (
        <>
          <section className="mb-4">
            <p className="text-sm font-medium">
              Qué sale hacia el proveedor de IA que has configurado
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Para leer tus documentos y responder tus preguntas, BusinessBrain
              envía el texto necesario al proveedor de IA. Esto es exactamente lo
              que sale y cuándo:
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-700">
              {notice.data.aiProvider.map((flujo) => (
                <li key={flujo.callSite} className="flex gap-2">
                  <span aria-hidden className="text-gray-400">
                    →
                  </span>
                  <span>
                    {flujo.what}{' '}
                    <span className="text-gray-500">{flujo.trigger}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mb-4">
            <p className="text-sm font-medium">Qué guarda BusinessBrain</p>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-700">
              {notice.data.stored.map((dato) => (
                <li key={dato.what}>
                  <span className="font-medium">{dato.what}.</span>{' '}
                  <span className="text-gray-600">{dato.detail}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Lo que todavía no está resuelto se dice. Un cliente que pregunta por el contrato
              de encargado de tratamiento y recibe silencio se lleva peor impresión que uno
              que recibe "todavía no, y lo sabemos". */}
          <section className="mb-4 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">
              Todavía pendiente
            </p>
            <ul className="mt-1 space-y-1 text-xs text-amber-900">
              {notice.data.pending.map((punto) => (
                <li key={punto}>{punto}</li>
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
  const action = useAction();

  return (
    <section className="mb-4 border-t border-gray-100 pt-3">
      <p className="text-sm font-medium">Llévate una copia</p>
      <p className="mt-1 text-xs text-gray-600">
        Un fichero con tus documentos, tus conversaciones, tus conclusiones y tus
        recomendaciones. No incluye tu clave del proveedor de IA ni ninguna
        credencial.
      </p>

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
        {action.busy ? 'Preparando…' : 'Descargar mis datos'}
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
  const { logout } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const action = useAction();

  return (
    <section className="border-t border-gray-100 pt-3">
      <p className="text-sm font-medium text-red-800">Borrar todo</p>
      <p className="mt-1 text-xs text-gray-600">
        Se borran los documentos, las conversaciones, las conclusiones, las
        recomendaciones y la configuración de esta empresa. No se puede deshacer.
        Las cuentas de las personas no se borran: pueden pertenecer a otra
        empresa.
      </p>

      {!abierto ? (
        <Button
          className="mt-2"
          variant="danger"
          onClick={() => setAbierto(true)}
        >
          Quiero borrar los datos de esta empresa
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
            label={`Escribe «${organizationName ?? ''}» para confirmar`}
            hint="Exactamente igual, incluidas mayúsculas y acentos."
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
              {action.busy ? 'Borrando…' : 'Borrar definitivamente'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAbierto(false);
                setNombre('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
