import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
  PageHeader,
  Table,
  inputClass,
  useAction,
  useFormatDate,
  useFormatDay,
  usePageTitle,
  useResource,
} from '../components/ui';
import { useT, type TranslationKey } from '../i18n';
import { useLabels } from '../i18n/labels';

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
 *
 * ## Nada de lo que hay aquí dentro se traduce
 *
 * Los títulos de los documentos, los nombres de las colecciones y de las fuentes, las etiquetas
 * de Gmail y las carpetas de Drive son de la empresa y de sus sistemas. Un documento llamado
 * "Contract with Acme Ltd." se llama así aunque la interfaz esté en castellano: es el nombre
 * con el que lo van a buscar.
 */
export function KnowledgePage() {
  const { role } = useAuth();
  const t = useT();
  const labels = useLabels();
  const formatDay = useFormatDay();
  const canAdmin = hasRole(role, 'ADMIN');
  usePageTitle('nav.knowledge');

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

  const indexados = (items.data ?? []).filter(
    (item) => item.status === 'INDEXED',
  ).length;
  const hayArea = (items.data ?? []).some((item) => item.businessArea);

  return (
    <>
      <PageHeader
        title={t('knowledge.title')}
        description={t('knowledge.subtitle')}
      />

      <Chain
        sources={sources.data?.length ?? 0}
        documents={items.data?.length ?? 0}
        understood={indexados}
      />

      <h2 className="mb-2 mt-6 t-micro text-muted">{t('knowledge.step.origin')}</h2>

      <CollectionsCard
        collections={collections.data ?? []}
        loading={collections.loading}
        error={collections.error}
        canCreate={canAdmin}
        onCreated={collections.reload}
      />

      {/*
        Drive y Gmail son OPCIONALES, y hasta ahora ocupaban dos tarjetas a ancho completo,
        con el mismo peso que las colecciones y las fuentes. Quien entraba veía cinco bloques
        idénticos y no tenía forma de saber cuáles hacen falta y cuáles son un extra.
      */}
      {canAdmin && (
        <Card title={t('knowledge.connect.title')}>
          <p className="mb-4 t-small text-muted">{t('knowledge.connect.why')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <GoogleDriveCard
              drive={drive}
              error={integrations.error}
              onChanged={integrations.reload}
            />
            <GmailCard
              gmail={gmailAny}
              error={integrations.error}
              onChanged={integrations.reload}
            />
          </div>
        </Card>
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

      <h2 className="mb-2 mt-6 t-micro text-muted">
        {t('knowledge.step.material')}
      </h2>

      <Card title={t('knowledge.items.title', { count: items.data?.length ?? 0 })}>
        {items.loading && <Empty>{t('common.loading')}</Empty>}
        <ErrorNote error={items.error} />
        {!items.loading && (items.data?.length ?? 0) === 0 && (
          <Empty>{t('knowledge.items.empty')}</Empty>
        )}
        {(items.data?.length ?? 0) > 0 && (
          <Table
            head={[
              t('knowledge.items.column.title'),
              // "Área" solo cuando alguna la tiene. Una columna entera vacía en la tabla
              // principal de la pantalla es ruido con encabezado.
              ...(hayArea ? [t('knowledge.items.column.area')] : []),
              t('knowledge.items.column.status'),
              t('knowledge.items.column.confidence'),
              t('knowledge.items.column.indexed'),
            ]}
          >
            {items.data?.map((item) => (
              <tr key={item.id}>
                <td className="px-5 py-3 t-body">{item.title}</td>
                {hayArea && (
                  <td className="px-5 py-3 t-small text-muted">
                    {item.businessArea}
                  </td>
                )}
                <td className="px-5 py-3">
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={item.status === 'INDEXED' ? 'good' : 'neutral'}>
                      {labels.knowledgeItemStatus(item.status)}
                    </Badge>
                    {item.sourceMissingSince && (
                      // No se ha borrado nada: el documento sigue aquí entero. Lo que ya no
                      // se puede es volver a comprobarlo contra su origen.
                      <Badge tone="warn">
                        {t('knowledge.items.missingAtSource')}
                      </Badge>
                    )}
                  </span>
                </td>
                {/* En palabras: "0.57" no le dice a nadie si puede fiarse del documento. */}
                <td className="px-5 py-3 t-small text-muted">
                  {labels.confidence(item.confidenceScore)}
                </td>
                <td className="px-5 py-3 t-small text-muted">
                  {formatDay(item.indexedAt)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/*
        El final de la cadena. Tener documentos indexados y no saber que ya se puede preguntar
        era el hueco más caro de esta pantalla: la persona terminaba de subir y se quedaba
        mirando una tabla, sin ninguna señal de que el trabajo ya servía para algo.
      */}
      {indexados > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sunken px-5 py-4">
          <p className="t-small text-ink-soft">
            {t('knowledge.chain.answersHint')}
          </p>
          <Link
            to="/preguntar"
            className="rounded-md bg-ink px-3.5 py-2 t-small font-medium text-canvas transition-colors hover:bg-ink-soft"
          >
            {t('knowledge.goAsk')}
          </Link>
        </div>
      )}
    </>
  );
}

/**
 * La cadena: fuentes → documentos → comprensión → respuestas.
 *
 * ## Por qué esto está en la pantalla y no en un manual
 *
 * Hasta la Fase 8, Conocimiento era una pila de seis tarjetas —colecciones, Drive, Gmail,
 * fuentes, documentos— sin ningún hilo entre ellas. Quien entraba veía formularios y no
 * entendía **para qué** servía nada de aquello: por qué hace falta una colección, qué relación
 * tiene una fuente con lo que sale al preguntar, ni en qué momento el sistema "ya sabe".
 *
 * Esta tira lo dice en una línea y con los números reales de la empresa. Si hay tres fuentes y
 * cero documentos, se ve el punto exacto donde se rompió la cadena — que es justo lo que
 * antes obligaba a mirar cinco tarjetas para deducir.
 */
function Chain({
  sources,
  documents,
  understood,
}: {
  sources: number;
  documents: number;
  understood: number;
}) {
  const t = useT();

  const pasos: { label: TranslationKey; hint: TranslationKey; value: number | null }[] =
    [
      {
        label: 'knowledge.chain.sources',
        hint: 'knowledge.chain.sourcesHint',
        value: sources,
      },
      {
        label: 'knowledge.chain.documents',
        hint: 'knowledge.chain.documentsHint',
        value: documents,
      },
      {
        label: 'knowledge.chain.understanding',
        hint: 'knowledge.chain.understandingHint',
        value: understood,
      },
      // Las respuestas no llevan número: no son un almacén, son lo que se obtiene. Poner un
      // contador aquí sugeriría que hay una cantidad limitada de respuestas disponibles.
      {
        label: 'knowledge.chain.answers',
        hint: 'knowledge.chain.answersHint',
        value: null,
      },
    ];

  return (
    <section
      aria-label={t('knowledge.chain.title')}
      className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4"
    >
      {pasos.map((paso, indice) => (
        <div key={paso.label} className="bg-surface p-4">
          <div className="flex items-baseline gap-2">
            <span className="t-micro text-faint">{indice + 1}</span>
            <span className="t-small font-medium text-ink">{t(paso.label)}</span>
            {paso.value !== null && (
              <span
                className={`ml-auto t-figure t-title ${
                  paso.value === 0 ? 'text-faint' : 'text-ink'
                }`}
              >
                {paso.value}
              </span>
            )}
          </div>
          <p className="mt-1 t-fine text-muted">{t(paso.hint)}</p>
        </div>
      ))}
    </section>
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
  const t = useT();
  const [name, setName] = useState('');
  const action = useAction();

  return (
    <Card title={t('knowledge.collections.title')}>
      <p className="mb-3 t-fine text-muted">
        {t('knowledge.collections.why')}
      </p>

      <ErrorNote error={error ?? action.error} />
      {loading && <Empty>{t('common.loading')}</Empty>}

      <ul className="mb-3 flex flex-wrap gap-2">
        {collections.map((collection) => (
          <li key={collection.id}>
            <Badge>{collection.name}</Badge>
          </li>
        ))}
        {!loading && collections.length === 0 && (
          <li className="t-small text-muted">
            {t('knowledge.collections.empty')}
          </li>
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
            <Field label={t('knowledge.collections.new')}>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('knowledge.collections.placeholder')}
                required
              />
            </Field>
          </div>
          <Button type="submit" disabled={action.busy}>
            {t('common.create')}
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
  const t = useT();
  const action = useAction();

  return (
    <div className="rounded-md border border-line p-4">
      <h3 className="mb-2 t-body font-medium text-ink">
        {t('knowledge.drive.title')}
      </h3>
      <ErrorNote error={error ?? action.error} />

      {drive ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="good">{t('knowledge.drive.connected')}</Badge>
          <span className="t-fine text-muted">
            {t('knowledge.drive.folders', {
              count: drive._count?.knowledgeSources ?? 0,
            })}
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
            {t('knowledge.disconnect')}
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 t-fine text-muted">
            {t('knowledge.drive.permission')}
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
            {t('knowledge.drive.connect')}
          </Button>
        </>
      )}
    </div>
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
  const t = useT();
  const action = useAction();
  const activa = gmail?.status === 'CONNECTED';

  return (
    <div className="rounded-md border border-line p-4">
      <h3 className="mb-2 t-body font-medium text-ink">
        {t('knowledge.gmail.title')}
      </h3>
      <ErrorNote error={error ?? action.error} />

      {activa ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="good">{t('knowledge.gmail.active')}</Badge>
          {/* La dirección de correo es de la empresa: se muestra tal cual. */}
          <span className="t-fine text-muted">
            {gmail?.accountLabel ?? t('knowledge.gmail.unknownAccount')}
          </span>
          <span className="t-fine text-muted">
            {t('knowledge.gmail.labels', {
              count: gmail?._count?.knowledgeSources ?? 0,
            })}
          </span>
          <Button
            variant="danger"
            className="ml-auto"
            disabled={action.busy}
            onClick={() =>
              void action
                .run(() =>
                  api(`/integrations/${gmail!.id}`, { method: 'DELETE' }),
                )
                .then(onChanged)
            }
          >
            {t('knowledge.disconnect')}
          </Button>
        </div>
      ) : (
        <>
          {/* Desconectar NO borra la conexion: queda registrada como revocada. Se dice —para
              que nadie se pregunte por que dejo de entrar correo— pero la accion disponible
              vuelve a ser conectar. Presentar solo "revocada" con un boton de desconectar
              dejaba a la empresa sin ninguna forma de volver a conectar su buzon. */}
          {gmail && (
            <p className="mb-2 flex items-center gap-2 t-fine text-muted">
              <Badge tone="warn">{t('knowledge.gmail.revoked')}</Badge>
              {t('knowledge.gmail.revokedExplain', {
                account:
                  gmail.accountLabel ?? t('knowledge.gmail.thatAccount'),
              })}
            </p>
          )}
          <p className="mb-3 t-fine text-muted">
            {t('knowledge.gmail.permission')}
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
            {t('knowledge.gmail.connect')}
          </Button>
        </>
      )}
    </div>
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
  const t = useT();
  const [name, setName] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [kind, setKind] = useState<
    'FILE_UPLOAD' | 'WEBSITE' | 'GOOGLE_DRIVE' | 'GMAIL'
  >('FILE_UPLOAD');
  const [url, setUrl] = useState('');
  const [folderId, setFolderId] = useState('');
  const [labelId, setLabelId] = useState('');
  const [anadiendo, setAnadiendo] = useState(false);
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
    <Card
      title={t('knowledge.sources.title')}
      actions={
        !anadiendo ? (
          <Button onClick={() => setAnadiendo(true)}>
            {t('knowledge.sources.add')}
          </Button>
        ) : undefined
      }
    >
      <ErrorNote error={error ?? create.error} />
      {loading && <Empty>{t('common.loading')}</Empty>}

      <ul className="mb-4 space-y-2">
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} onSynced={onChanged} />
        ))}
        {!loading && sources.length === 0 && (
          <li className="t-small text-muted">
            {t('knowledge.sources.empty')}
          </li>
        )}
      </ul>

      {anadiendo && (
      <form
        className="flex flex-wrap items-end gap-2 border-t border-line pt-4"
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
          setAnadiendo(false);
          onChanged();
        })}
      >
        <div className="min-w-40">
          <Field label={t('knowledge.sources.kind')}>
            <select
              aria-label={t('knowledge.sources.kind')}
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
              <option value="FILE_UPLOAD">
                {t('knowledge.sources.kind.upload')}
              </option>
              <option value="WEBSITE">
                {t('knowledge.sources.kind.website')}
              </option>
              {drive && (
                <option value="GOOGLE_DRIVE">
                  {t('knowledge.sources.kind.drive')}
                </option>
              )}
              {gmail && (
                <option value="GMAIL">{t('knowledge.sources.kind.gmail')}</option>
              )}
            </select>
          </Field>
        </div>
        <div className="min-w-48 flex-1">
          <Field label={t('knowledge.sources.new')}>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(
                kind === 'WEBSITE'
                  ? 'knowledge.sources.namePlaceholder.website'
                  : 'knowledge.sources.namePlaceholder.upload',
              )}
              required
            />
          </Field>
        </div>
        {kind === 'GOOGLE_DRIVE' && (
          <div className="min-w-56 flex-1">
            <Field
              label={t('knowledge.sources.driveFolder')}
              hint={t('knowledge.sources.driveFolderHint')}
            >
              <select
                className={inputClass}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                required
              >
                <option value="">
                  {folders.loading
                    ? t('knowledge.sources.loadingFolders')
                    : t('knowledge.sources.chooseOne')}
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
              label={t('knowledge.sources.gmailLabel')}
              hint={t('knowledge.sources.gmailLabelHint')}
            >
              <select
                aria-label={t('knowledge.sources.gmailLabel')}
                className={inputClass}
                value={labelId}
                onChange={(e) => setLabelId(e.target.value)}
                required
              >
                <option value="">
                  {labels.loading
                    ? t('knowledge.sources.loadingLabels')
                    : t('knowledge.sources.chooseOne')}
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
              label={t('knowledge.sources.url')}
              hint={t('knowledge.sources.urlHint')}
            >
              <input
                type="url"
                className={inputClass}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('knowledge.sources.urlPlaceholder')}
                required
              />
            </Field>
          </div>
        )}
        <div className="min-w-48">
          <Field
            label={t('knowledge.sources.collection')}
            hint={t(
              kind === 'GMAIL'
                ? 'knowledge.sources.collectionHintGmail'
                : 'knowledge.sources.collectionHint',
            )}
          >
            <select
              className={inputClass}
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              required
            >
              <option value="">{t('knowledge.sources.chooseOne')}</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={create.busy || collections.length === 0}
        >
          {t('knowledge.sources.create')}
        </Button>
        <Button type="button" onClick={() => setAnadiendo(false)}>
          {t('knowledge.sources.cancel')}
        </Button>
      </form>
      )}
    </Card>
  );
}

/**
 * Mensaje de error que puede leer una persona.
 *
 * La API devuelve texto en `error`, pero la validación de entrada devuelve una LISTA de motivos.
 * Enseñar el array crudo pondría corchetes y comillas en la pantalla.
 */
function readableError(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (Array.isArray(error) && typeof error[0] === 'string') return error[0];
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return null;
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
  const t = useT();
  const labels = useLabels();
  const formatDate = useFormatDate();
  const fileInput = useRef<HTMLInputElement>(null);
  const action = useAction();
  // Se guarda la CLAVE y el nombre del fichero, no la frase ya montada: si la persona cambia
  // de idioma con el mensaje en pantalla, el mensaje cambia con ella.
  const [resultado, setResultado] = useState<{
    key: TranslationKey;
    file: string;
    ok: boolean;
  } | null>(null);

  // La lista de formatos la publica el backend, que es quien valida. Tenerla aquí a mano fue
  // exactamente el fallo anterior: el selector ofrecía PDF y Word y la ingesta los rechazaba.
  const formats = useResource(() =>
    api<{ extensions: string[]; mimeTypes: string[] }>(
      '/knowledge-sources/supported-formats',
    ),
  );

  const upload = (file: File) =>
    action.run(async () => {
      const form = new FormData();
      form.append('file', file);

      setResultado(null);
      const response = await fetch(`/api/knowledge-sources/${source.id}/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken ?? ''}`,
          'x-org-id': session.organizationId ?? '',
        },
        body: form,
      });
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
        data?: { stats?: { itemsCreated?: number; itemsFailed?: number } };
      } | null;

      if (!response.ok) {
        throw new Error(
          readableError(body?.error) ?? t('knowledge.upload.failed'),
        );
      }

      // El resultado por documento, en la pantalla. Una ingesta que termina "bien" con cero
      // documentos creados es justo el caso en el que la persona cree que ha funcionado.
      const stats = body?.data?.stats;
      const fallo = (stats?.itemsFailed ?? 0) > 0;
      setResultado({
        key: fallo
          ? 'knowledge.upload.unreadable'
          : (stats?.itemsCreated ?? 0) > 0
            ? 'knowledge.upload.indexed'
            : 'knowledge.upload.duplicate',
        file: file.name,
        ok: !fallo,
      });
      onSynced();
    });

  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-line px-3 py-2">
      <span className="t-small font-medium">{source.name}</span>
      <Badge tone={source.status === 'CONNECTED' ? 'good' : 'neutral'}>
        {labels.connectionStatus(source.status)}
      </Badge>
      {source.syncScope && (
        // QUE se esta sincronizando: la etiqueta, la carpeta o la direccion. Sin esto, dos
        // fuentes del mismo tipo son indistinguibles. Es un nombre de sus sistemas: sin tocar.
        <span className="t-fine text-muted">{source.syncScope}</span>
      )}
      <span className="t-fine text-muted">
        {t('knowledge.source.lastSync', {
          date: formatDate(source.lastSyncedAt),
        })}
      </span>
      {source.lastSync?.stats && (
        // Lo que trajo de verdad. "Sincronizado" no distingue traer 40 mensajes de ninguno.
        <span className="t-fine text-muted">
          {t('knowledge.source.stats', {
            created: source.lastSync.stats.itemsCreated ?? 0,
            updated: source.lastSync.stats.itemsUpdated ?? 0,
          })}
          {(source.lastSync.stats.itemsFailed ?? 0) > 0 &&
            t('knowledge.source.statsFailed', {
              failed: source.lastSync.stats.itemsFailed ?? 0,
            })}
        </span>
      )}
      {(source.lastSync?.stats?.itemsNotRetrievable ?? 0) > 0 && (
        // El documento está aquí y se ve en la lista, pero NO aparece al preguntar. Callarlo
        // dejaría a la persona creyendo que el sistema ignoró su documento.
        <span className="t-fine text-attention">
          {t('knowledge.source.notRetrievable', {
            count: source.lastSync?.stats?.itemsNotRetrievable ?? 0,
          })}
        </span>
      )}
      {source.lastError && (
        <span className="t-fine text-danger">{source.lastError}</span>
      )}

      {resultado && (
        <span
          className={`t-fine ${resultado.ok ? 'text-positive' : 'text-attention'}`}
        >
          {t(resultado.key, { file: resultado.file })}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {action.error instanceof Error && (
          <span className="t-fine text-danger">{action.error.message}</span>
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
              ? t('knowledge.source.syncing')
              : source.type === 'WEBSITE'
                ? t('knowledge.source.readPage')
                : t('knowledge.source.sync')}
          </Button>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept={formats.data?.extensions.join(',')}
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
              {action.busy
                ? t('knowledge.source.uploading')
                : t('knowledge.source.upload')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
