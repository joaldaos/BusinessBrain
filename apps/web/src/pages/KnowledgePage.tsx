import { useRef, useState } from 'react';
import { api, session } from '../api/client';
import { useAuth } from '../auth';
import {
  hasRole,
  type DriveFolder,
  type GmailLabel,
  type Integration,
  type KnowledgeCollection,
  type KnowledgeItem,
  type KnowledgeSource,
} from '../api/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Table,
  formatDate,
  inputClass,
  useAction,
  useResource,
} from '../components/ui';

/**
 * Conocimiento: colecciones, fuentes y documentos.
 *
 * ## Por qué la colección va primero
 *
 * Una colección es la **unidad de alcance** de todo el sistema. Un documento que no pertenece
 * a ninguna tiene alcance efectivo vacío, y por la regla fail-closed nadie ve nada derivado de
 * él — ni siquiera quien lo subió. Por eso la pantalla obliga a elegir colección al crear una
 * fuente, en vez de dejarlo como un detalle opcional que se descubre cuando la lista de
 * conclusiones aparece vacía sin explicación.
 */
export function KnowledgePage() {
  const { role } = useAuth();
  const canAdmin = hasRole(role, 'ADMIN');

  const collections = useResource(() =>
    api<KnowledgeCollection[]>('/knowledge-collections'),
  );
  const sources = useResource(() => api<KnowledgeSource[]>('/knowledge-sources'));
  const items = useResource(() => api<KnowledgeItem[]>('/knowledge-items'));
  const integrations = useResource(() => api<Integration[]>('/integrations'));

  const connected = (provider: string) =>
    (integrations.data ?? []).find(
      (integration) =>
        integration.provider === provider && integration.status === 'CONNECTED',
    );
  const drive = connected('GOOGLE_DRIVE');
  const gmail = connected('GMAIL');
  // Una conexión revocada o en error se sigue mostrando: "no aparece" y "está desconectada"
  // son cosas distintas, y la segunda hay que poder verla para arreglarla.
  const gmailAny = (integrations.data ?? []).find(
    (integration) => integration.provider === 'GMAIL',
  );

  return (
    <>
      <CollectionsCard
        collections={collections.data ?? []}
        loading={collections.loading}
        error={collections.error}
        canCreate={canAdmin}
        onCreated={collections.reload}
      />

      {canAdmin && (
        <GoogleDriveCard
          drive={drive}
          error={integrations.error}
          onChanged={integrations.reload}
        />
      )}

      {canAdmin && (
        <GmailCard
          gmail={gmailAny}
          error={integrations.error}
          onChanged={integrations.reload}
        />
      )}

      <SourcesCard
        sources={sources.data ?? []}
        collections={collections.data ?? []}
        drive={drive}
        gmail={gmail}
        loading={sources.loading}
        error={sources.error}
        onChanged={() => {
          sources.reload();
          items.reload();
        }}
      />

      <Card title={`Documentos (${items.data?.length ?? 0})`}>
        {items.loading && <Empty>Cargando…</Empty>}
        <ErrorNote error={items.error} />
        {!items.loading && (items.data?.length ?? 0) === 0 && (
          <Empty>Aún no hay documentos indexados.</Empty>
        )}
        {(items.data?.length ?? 0) > 0 && (
          <Table head={['Título', 'Área', 'Estado', 'Confianza', 'Indexado']}>
            {items.data?.map((item) => (
              <tr key={item.id} className="border-b border-gray-100 last:border-0">
                <td className="px-2 py-2">{item.title}</td>
                <td className="px-2 py-2 text-gray-600">{item.businessArea}</td>
                <td className="px-2 py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={item.status === 'INDEXED' ? 'good' : 'neutral'}>
                      {item.status}
                    </Badge>
                    {item.sourceMissingSince && (
                      // No se ha borrado nada: el documento sigue aquí entero. Lo que ya no
                      // se puede es volver a comprobarlo contra su origen.
                      <Badge tone="warn">ya no está en su origen</Badge>
                    )}
                  </span>
                </td>
                <td className="px-2 py-2 text-gray-600">
                  {item.confidenceScore?.toFixed(2) ?? '—'}
                </td>
                <td className="px-2 py-2 text-gray-600">
                  {formatDate(item.indexedAt)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function CollectionsCard({
  collections,
  loading,
  error,
  canCreate,
  onCreated,
}: {
  collections: KnowledgeCollection[];
  loading: boolean;
  error: unknown;
  canCreate: boolean;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const action = useAction();

  return (
    <Card title="Colecciones">
      <p className="mb-3 text-xs text-gray-500">
        Una colección delimita quién puede ver qué. Todo documento debe estar en
        alguna: lo que no pertenece a ninguna no lo ve nadie.
      </p>

      <ErrorNote error={error ?? action.error} />
      {loading && <Empty>Cargando…</Empty>}

      <ul className="mb-3 flex flex-wrap gap-2">
        {collections.map((collection) => (
          <li key={collection.id}>
            <Badge>{collection.name}</Badge>
          </li>
        ))}
        {!loading && collections.length === 0 && (
          <li className="text-sm text-gray-500">Ninguna todavía.</li>
        )}
      </ul>

      {canCreate && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={action.onSubmit(async () => {
            await api('/knowledge-collections', {
              method: 'POST',
              body: { name },
            });
            setName('');
            onCreated();
          })}
        >
          <div className="min-w-48 flex-1">
            <Field label="Nueva colección">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ventas"
                required
              />
            </Field>
          </div>
          <Button type="submit" disabled={action.busy}>
            Crear
          </Button>
        </form>
      )}
    </Card>
  );
}

/**
 * Conexion con Google Drive.
 *
 * Conectar abre la pantalla de consentimiento de Google en esta misma ventana: es una
 * navegacion de verdad, no una llamada — el flujo de OAuth vuelve al servidor con un codigo en
 * la URL, y para eso el navegador tiene que ir y volver.
 */
function GoogleDriveCard({
  drive,
  error,
  onChanged,
}: {
  drive: Integration | undefined;
  error: unknown;
  onChanged: () => void;
}) {
  const action = useAction();

  return (
    <Card title="Google Drive">
      <ErrorNote error={error ?? action.error} />

      {drive ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="good">conectado</Badge>
          <span className="text-xs text-gray-600">
            {drive._count?.knowledgeSources ?? 0} carpeta(s) sincronizandose
          </span>
          <Button
            variant="danger"
            className="ml-auto"
            disabled={action.busy}
            onClick={() =>
              void action
                .run(() => api(`/integrations/${drive.id}`, { method: 'DELETE' }))
                .then(onChanged)
            }
          >
            Desconectar
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-gray-500">
            BusinessBrain pedira permiso de SOLO LECTURA sobre tu Drive. Nunca
            escribe ni modifica nada, y puedes retirarlo cuando quieras.
          </p>
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const { authorizationUrl } = await api<{
                  authorizationUrl: string;
                }>('/integrations/google-drive/connect');
                window.location.href = authorizationUrl;
              })
            }
          >
            Conectar Google Drive
          </Button>
        </>
      )}
    </Card>
  );
}

/**
 * Conexion con Gmail.
 *
 * Dice QUE cuenta esta conectada, no solo que lo esta: en una empresa con varias direcciones,
 * "Gmail conectado" no permite auditar nada ni decidir si conviene desconectar.
 *
 * Una conexion revocada o en error se muestra igualmente. Hacerla desaparecer dejaria a la
 * persona sin entender por que sus fuentes han dejado de traer correo.
 */
function GmailCard({
  gmail,
  error,
  onChanged,
}: {
  gmail: Integration | undefined;
  error: unknown;
  onChanged: () => void;
}) {
  const action = useAction();
  const activa = gmail?.status === 'CONNECTED';

  return (
    <Card title="Gmail">
      <ErrorNote error={error ?? action.error} />

      {gmail ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={activa ? 'good' : 'warn'}>
            {activa ? 'activa' : 'revocada'}
          </Badge>
          <span className="text-xs text-gray-600">
            {gmail.accountLabel ?? 'cuenta no identificada'}
          </span>
          <span className="text-xs text-gray-500">
            {gmail._count?.knowledgeSources ?? 0} etiqueta(s) sincronizandose
          </span>
          <Button
            variant="danger"
            className="ml-auto"
            disabled={action.busy}
            onClick={() =>
              void action
                .run(() => api(`/integrations/${gmail.id}`, { method: 'DELETE' }))
                .then(onChanged)
            }
          >
            Desconectar
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-gray-500">
            BusinessBrain pedira permiso de SOLO LECTURA sobre tu correo. Nunca
            envia ni modifica nada. Solo entrara la etiqueta que elijas, y el
            correo indexado ira a una coleccion de acceso restringido: conectar
            Gmail no lo hace visible a toda la organizacion.
          </p>
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const { authorizationUrl } = await api<{
                  authorizationUrl: string;
                }>('/integrations/gmail/connect');
                window.location.href = authorizationUrl;
              })
            }
          >
            Conectar Gmail
          </Button>
        </>
      )}
    </Card>
  );
}

function SourcesCard({
  sources,
  collections,
  drive,
  gmail,
  loading,
  error,
  onChanged,
}: {
  sources: KnowledgeSource[];
  collections: KnowledgeCollection[];
  drive: Integration | undefined;
  gmail: Integration | undefined;
  loading: boolean;
  error: unknown;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [kind, setKind] = useState<
    'FILE_UPLOAD' | 'WEBSITE' | 'GOOGLE_DRIVE' | 'GMAIL'
  >('FILE_UPLOAD');
  const [url, setUrl] = useState('');
  const [folderId, setFolderId] = useState('');
  const [labelId, setLabelId] = useState('');
  const create = useAction();

  // Las carpetas se piden solo cuando hacen falta: listar el Drive de alguien sin que lo
  // haya pedido seria trabajo y exposicion gratuitos.
  const folders = useResource(
    () =>
      kind === 'GOOGLE_DRIVE' && drive
        ? api<DriveFolder[]>(`/integrations/${drive.id}/folders`)
        : Promise.resolve([]),
    [kind, drive?.id],
  );
  // Igual con las etiquetas: no se abre el buzon de nadie sin que lo haya pedido.
  const labels = useResource(
    () =>
      kind === 'GMAIL' && gmail
        ? api<GmailLabel[]>(`/integrations/${gmail.id}/labels`)
        : Promise.resolve([]),
    [kind, gmail?.id],
  );

  return (
    <Card title="Fuentes de conocimiento">
      <ErrorNote error={error ?? create.error} />
      {loading && <Empty>Cargando…</Empty>}

      <ul className="mb-4 space-y-2">
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} onSynced={onChanged} />
        ))}
        {!loading && sources.length === 0 && (
          <li className="text-sm text-gray-500">
            Ninguna todavía. Crea una para poder subir documentos.
          </li>
        )}
      </ul>

      <form
        className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3"
        onSubmit={create.onSubmit(async () => {
          const connectorKey = {
            FILE_UPLOAD: 'file_upload_v1',
            WEBSITE: 'web_page_v1',
            GOOGLE_DRIVE: 'google_drive_v1',
            GMAIL: 'gmail_v1',
          }[kind];

          const config =
            kind === 'WEBSITE'
              ? { url: url.trim() }
              : kind === 'GOOGLE_DRIVE'
                ? { integrationId: drive?.id, folderId }
                : kind === 'GMAIL'
                  ? {
                      integrationId: gmail?.id,
                      labelId,
                      // Se guarda el nombre para poder decir despues QUE etiqueta entra;
                      // el identificador solo no le dice nada a nadie.
                      labelName: labels.data?.find(
                        (label) => label.id === labelId,
                      )?.name,
                    }
                  : {};

          const integrationId =
            kind === 'GOOGLE_DRIVE'
              ? drive?.id
              : kind === 'GMAIL'
                ? gmail?.id
                : undefined;

          await api('/knowledge-sources', {
            method: 'POST',
            body: {
              name,
              type: kind,
              connectorKey,
              config,
              ...(integrationId ? { integrationId } : {}),
              knowledgeCollectionIds: collectionId ? [collectionId] : [],
            },
          });
          setName('');
          setUrl('');
          setFolderId('');
          setLabelId('');
          onChanged();
        })}
      >
        <div className="min-w-40">
          <Field label="Tipo de fuente">
            <select
              aria-label="Tipo de fuente"
              className={inputClass}
              value={kind}
              onChange={(e) =>
                setKind(
                  e.target.value as
                    | 'FILE_UPLOAD'
                    | 'WEBSITE'
                    | 'GOOGLE_DRIVE'
                    | 'GMAIL',
                )
              }
            >
              <option value="FILE_UPLOAD">Documentos que subo yo</option>
              <option value="WEBSITE">Una página web</option>
              {drive && (
                <option value="GOOGLE_DRIVE">Una carpeta de Google Drive</option>
              )}
              {gmail && <option value="GMAIL">Una etiqueta de Gmail</option>}
            </select>
          </Field>
        </div>
        <div className="min-w-48 flex-1">
          <Field label="Nueva fuente">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === 'WEBSITE' ? 'Política de descuentos' : 'Documentos de ventas'
              }
              required
            />
          </Field>
        </div>
        {kind === 'GOOGLE_DRIVE' && (
          <div className="min-w-56 flex-1">
            <Field
              label="Carpeta de Drive"
              hint="Se leera entera la primera vez; despues, solo lo que cambie."
            >
              <select
                className={inputClass}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                required
              >
                <option value="">
                  {folders.loading ? 'Cargando carpetas…' : 'Elige una…'}
                </option>
                {folders.data?.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {kind === 'GMAIL' && (
          <div className="min-w-56 flex-1">
            <Field
              label="Etiqueta de Gmail"
              hint="Solo entrara el correo de esta etiqueta. Nada de fuera de ella se sincroniza."
            >
              <select
                aria-label="Etiqueta de Gmail"
                className={inputClass}
                value={labelId}
                onChange={(e) => setLabelId(e.target.value)}
                required
              >
                <option value="">
                  {labels.loading ? 'Cargando etiquetas…' : 'Elige una…'}
                </option>
                {labels.data?.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {kind === 'WEBSITE' && (
          <div className="min-w-64 flex-1">
            <Field
              label="Dirección web"
              hint="Debe ser accesible desde internet. BusinessBrain la leerá y la volverá a leer cuando lo pidas."
            >
              <input
                type="url"
                className={inputClass}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://ejemplo.com/politica-de-descuentos"
                required
              />
            </Field>
          </div>
        )}
        <div className="min-w-48">
          <Field
            label="Colección de destino"
            hint={
              kind === 'GMAIL'
                ? 'El correo exige una coleccion RESTRINGIDA: elige una a la que no tenga acceso toda la organizacion.'
                : 'Sin colección, lo que subas no lo verá nadie.'
            }
          >
            <select
              className={inputClass}
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              required
            >
              <option value="">Elige una…</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button type="submit" disabled={create.busy || collections.length === 0}>
          Crear fuente
        </Button>
      </form>
    </Card>
  );
}

/**
 * Una fuente y su carga de documentos.
 *
 * La subida va por `multipart/form-data`, así que no pasa por el cliente JSON: se construye a
 * mano con las mismas cabeceras de sesión y organización, sin `Content-Type` —el navegador lo
 * fija con su propio `boundary`, y ponerlo a mano rompería la petición—.
 */
function SourceRow({
  source,
  onSynced,
}: {
  source: KnowledgeSource;
  onSynced: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const action = useAction();

  const upload = (file: File) =>
    action.run(async () => {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch(
        `/api/knowledge-sources/${source.id}/sync`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken ?? ''}`,
            'x-org-id': session.organizationId ?? '',
          },
          body: form,
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          typeof body?.error === 'string'
            ? body.error
            : `No se pudo subir el documento (${response.status})`,
        );
      }
      onSynced();
    });

  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-gray-200 px-3 py-2">
      <span className="text-sm font-medium">{source.name}</span>
      <Badge tone={source.status === 'CONNECTED' ? 'good' : 'neutral'}>
        {source.status}
      </Badge>
      {source.syncScope && (
        // QUE se esta sincronizando: la etiqueta, la carpeta o la direccion. Sin esto, dos
        // fuentes del mismo tipo son indistinguibles.
        <span className="text-xs text-gray-600">{source.syncScope}</span>
      )}
      <span className="text-xs text-gray-500">
        última sincronización {formatDate(source.lastSyncedAt)}
      </span>
      {source.lastSync?.stats && (
        // Lo que trajo de verdad. "Sincronizado" no distingue traer 40 mensajes de ninguno.
        <span className="text-xs text-gray-600">
          {source.lastSync.stats.itemsCreated ?? 0} nuevo(s),{' '}
          {source.lastSync.stats.itemsUpdated ?? 0} actualizado(s)
          {(source.lastSync.stats.itemsFailed ?? 0) > 0 &&
            `, ${source.lastSync.stats.itemsFailed} con error`}
        </span>
      )}
      {source.lastError && (
        <span className="text-xs text-red-700">{source.lastError}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {action.error instanceof Error && (
          <span className="text-xs text-red-700">{action.error.message}</span>
        )}

        {source.type === 'WEBSITE' ||
        source.type === 'GOOGLE_DRIVE' ||
        source.type === 'GMAIL' ? (
          // Una fuente web va a buscar su contenido: no hay nada que subir. Volver a
          // sincronizar no duplica — si la página no cambió, el sistema lo reconoce.
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/knowledge-sources/${source.id}/sync`, {
                  method: 'POST',
                });
                onSynced();
              })
            }
          >
            {action.busy
              ? 'Sincronizando…'
              : source.type === 'WEBSITE'
                ? 'Leer la página'
                : 'Sincronizar'}
          </Button>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".txt,.md,.pdf,.docx,.html"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() => fileInput.current?.click()}
            >
              {action.busy ? 'Subiendo…' : 'Subir documento'}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
