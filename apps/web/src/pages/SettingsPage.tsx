import { useState } from 'react';
import { api } from '../api/client';
import { AiConfigurationCard } from '../components/AiConfigurationCard';
import { useAuth } from '../auth';
import {
  hasRole,
  type Invitation,
  type KnowledgeCollection,
  type MembershipRole,
  type Organization,
} from '../api/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Table,
  inputClass,
  useAction,
  useResource,
} from '../components/ui';

interface Member {
  userId: string;
  role: string;
  user: { id: string; email: string; name: string };
}

/**
 * Configuración: la organización, quién está en ella y quién ve qué.
 *
 * La concesión de acceso a colecciones es la pieza más delicada de esta pantalla: **es lo que
 * determina qué comprensión ve cada persona**. Por eso se muestra por colección y con nombre y
 * correo de cada miembro, en vez de con identificadores: conceder acceso al usuario
 * equivocado por confundir dos cuid es un error que nadie detectaría después.
 */
export function SettingsPage() {
  const { organizationId, role } = useAuth();
  const canAdmin = hasRole(role, 'ADMIN');

  const organization = useResource(
    () => api<Organization>(`/organizations/${organizationId}`),
    [organizationId],
  );
  const members = useResource(
    () => api<Member[]>(`/organizations/${organizationId}/members`),
    [organizationId],
  );
  const collections = useResource(() =>
    api<KnowledgeCollection[]>('/knowledge-collections'),
  );

  return (
    <>
      {/* Primero: sin IA no hay producto, y explica por qué una pregunta no encuentra nada. */}
      <AiConfigurationCard canAdmin={canAdmin} />

      <Card title="Organización">
        <ErrorNote error={organization.error} />
        {organization.data && (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500">Nombre</dt>
              <dd>{organization.data.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Identificador</dt>
              <dd className="font-mono text-xs">{organization.data.slug}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Tu rol</dt>
              <dd>
                <Badge>{role}</Badge>
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <Card title={`Miembros (${members.data?.length ?? 0})`}>
        <ErrorNote error={members.error} />
        {members.loading && <Empty>Cargando…</Empty>}
        {(members.data?.length ?? 0) > 0 && (
          <Table head={['Nombre', 'Correo', 'Rol']}>
            {members.data?.map((member) => (
              <tr
                key={member.userId}
                className="border-b border-gray-100 last:border-0"
              >
                <td className="px-2 py-2">{member.user?.name ?? '—'}</td>
                <td className="px-2 py-2 text-gray-600">
                  {member.user?.email ?? '—'}
                </td>
                <td className="px-2 py-2">
                  <Badge>{member.role}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canAdmin && (
        <InviteCard
          organizationId={organizationId}
          onInvited={members.reload}
        />
      )}

      {canAdmin && (
        <Card title="Quién ve qué">
          <p className="mb-3 text-xs text-gray-500">
            El acceso a una colección determina qué comprensión puede leer una
            persona. Si no cubre TODAS las colecciones en las que se apoya una
            conclusión, no la ve — el acceso parcial deniega.
          </p>

          <ErrorNote error={collections.error} />
          {(collections.data?.length ?? 0) === 0 && (
            <Empty>Crea una colección en Conocimiento para empezar.</Empty>
          )}

          <ul className="space-y-3">
            {collections.data?.map((collection) => (
              <CollectionAccess
                key={collection.id}
                collection={collection}
                members={members.data ?? []}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/**
 * Invitar a alguien de la empresa.
 *
 * ## Por qué es un enlace y no un correo
 *
 * BusinessBrain no envía correo todavía, y montar un envío a medias —que falle en silencio y
 * deje invitaciones que nadie recibe— sería peor que no tenerlo. Se entrega el enlace para
 * copiar y pegar por donde la empresa ya se comunica. Cuando exista envío de correo, esta
 * pantalla cambia y la invitación no.
 *
 * El enlace no es un permiso en blanco: al aceptarlo, el backend exige que el correo de quien
 * acepta COINCIDA con el invitado, así que reenviarlo a otra persona no le da acceso.
 *
 * ## Por qué importa para el producto
 *
 * Sin segundo usuario no existe la mitad de BusinessBrain: las colecciones restringidas no
 * restringen nada, el perímetro de un buzón es indistinguible de no tenerlo, y no hay a quién
 * mostrar una conclusión distinta de la propia.
 */
function InviteCard({
  organizationId,
  onInvited,
}: {
  organizationId: string | null;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('MEMBER');
  const [link, setLink] = useState<string | null>(null);
  const action = useAction();

  return (
    <Card title="Invitar a alguien">
      <p className="mb-3 text-xs text-gray-500">
        Se crea un enlace de invitación. Cópialo y mándaselo por donde ya habléis:
        BusinessBrain todavía no envía correos. Solo funcionará para esa dirección.
      </p>

      <ErrorNote error={action.error} />

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={action.onSubmit(async () => {
          const invitation = await api<Invitation>(
            `/organizations/${organizationId}/invitations`,
            { method: 'POST', body: { email: email.trim(), role } },
          );
          setLink(
            `${window.location.origin}/login?invitacion=${invitation.token}`,
          );
          setEmail('');
          onInvited();
        })}
      >
        <div className="min-w-56 flex-1">
          <Field label="Correo de la persona">
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="companero@tuempresa.com"
              required
            />
          </Field>
        </div>
        <div className="min-w-40">
          <Field label="Rol" hint="VIEWER solo lee; MEMBER puede preguntar y curar.">
            <select
              aria-label="Rol"
              className={inputClass}
              value={role}
              onChange={(event) =>
                setRole(event.target.value as MembershipRole)
              }
            >
              <option value="VIEWER">Solo lectura</option>
              <option value="MEMBER">Miembro</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </Field>
        </div>
        <Button type="submit" disabled={action.busy}>
          Crear invitación
        </Button>
      </form>

      {link && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-600">
            Enlace de invitación. Caduca, y solo sirve para el correo indicado:
          </p>
          <code className="mt-1 block break-all text-xs">{link}</code>
        </div>
      )}
    </Card>
  );
}

function CollectionAccess({
  collection,
  members,
}: {
  collection: KnowledgeCollection;
  members: Member[];
}) {
  const [userId, setUserId] = useState('');
  const action = useAction();
  const granted = useResource(
    () =>
      api<{ userId: string; user?: { name: string; email: string } }[]>(
        `/knowledge-collections/${collection.id}/access`,
      ),
    [collection.id],
  );

  return (
    <li className="rounded border border-gray-200 p-3">
      <p className="text-sm font-medium">{collection.name}</p>

      <ul className="mt-2 flex flex-wrap gap-2">
        {granted.data?.map((grant) => (
          <li key={grant.userId} className="flex items-center gap-1">
            <Badge tone="good">
              {grant.user?.name ?? grant.user?.email ?? grant.userId}
            </Badge>
            <button
              type="button"
              title="Retirar acceso"
              className="text-xs text-red-700 underline"
              onClick={() =>
                void action
                  .run(() =>
                    api(
                      `/knowledge-collections/${collection.id}/access/${grant.userId}`,
                      { method: 'DELETE' },
                    ),
                  )
                  .then(granted.reload)
              }
            >
              retirar
            </button>
          </li>
        ))}
        {(granted.data?.length ?? 0) === 0 && !granted.loading && (
          <li className="text-xs text-gray-500">Nadie tiene acceso todavía.</li>
        )}
      </ul>

      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={action.onSubmit(async () => {
          await api(`/knowledge-collections/${collection.id}/access`, {
            method: 'POST',
            body: { userId },
          });
          setUserId('');
          granted.reload();
        })}
      >
        <div className="min-w-56">
          <Field label="Conceder acceso a">
            <select
              className={inputClass}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            >
              <option value="">Elige a alguien…</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user?.name} ({member.user?.email})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={action.busy}>
          Conceder
        </Button>
      </form>

      <ErrorNote error={action.error ?? granted.error} />
    </li>
  );
}
