import { useRef, useState } from 'react';
import { api, session } from '../api/client';
import { useAuth } from '../auth';
import { hasRole, type KnowledgeCollection, type KnowledgeItem, type KnowledgeSource } from '../api/types';
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

  return (
    <>
      <CollectionsCard
        collections={collections.data ?? []}
        loading={collections.loading}
        error={collections.error}
        canCreate={canAdmin}
        onCreated={collections.reload}
      />

      <SourcesCard
        sources={sources.data ?? []}
        collections={collections.data ?? []}
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
                  <Badge tone={item.status === 'INDEXED' ? 'good' : 'neutral'}>
                    {item.status}
                  </Badge>
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

function SourcesCard({
  sources,
  collections,
  loading,
  error,
  onChanged,
}: {
  sources: KnowledgeSource[];
  collections: KnowledgeCollection[];
  loading: boolean;
  error: unknown;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [kind, setKind] = useState<'FILE_UPLOAD' | 'WEBSITE'>('FILE_UPLOAD');
  const [url, setUrl] = useState('');
  const create = useAction();

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
          const web = kind === 'WEBSITE';
          await api('/knowledge-sources', {
            method: 'POST',
            body: {
              name,
              type: kind,
              connectorKey: web ? 'web_page_v1' : 'file_upload_v1',
              ...(web ? { config: { url: url.trim() } } : {}),
              knowledgeCollectionIds: collectionId ? [collectionId] : [],
            },
          });
          setName('');
          setUrl('');
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
                setKind(e.target.value as 'FILE_UPLOAD' | 'WEBSITE')
              }
            >
              <option value="FILE_UPLOAD">Documentos que subo yo</option>
              <option value="WEBSITE">Una página web</option>
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
            hint="Sin colección, lo que subas no lo verá nadie."
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
      <span className="text-xs text-gray-500">
        última sincronización {formatDate(source.lastSyncAt)}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {action.error instanceof Error && (
          <span className="text-xs text-red-700">{action.error.message}</span>
        )}

        {source.type === 'WEBSITE' ? (
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
            {action.busy ? 'Leyendo…' : 'Leer la página'}
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
