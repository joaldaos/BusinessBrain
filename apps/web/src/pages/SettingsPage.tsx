import { useState } from 'react';
import { api } from '../api/client';
import { AiConfigurationCard } from '../components/AiConfigurationCard';
import { AiUsageCard } from '../components/AiUsageCard';
import { PrivacyCard } from '../components/PrivacyCard';
import { SecurityCard } from '../components/SecurityCard';
import { LanguagePicker } from '../components/LanguagePicker';
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
import { useT } from '../i18n';
import { useLabels } from '../i18n/labels';

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
  const t = useT();
  const labels = useLabels();
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
      {/* El idioma primero: si alguien no entiende la pantalla, es lo único que necesita
          encontrar. */}
      <Card title={t('settings.language')}>
        <p className="mb-3 text-xs text-gray-500">{t('settings.languageHint')}</p>
        <LanguagePicker compact />
      </Card>

      {/* La seguridad de la CUENTA, antes que nada de la empresa: es lo único de esta
          pantalla que protege a la persona aunque cambie de empresa. */}
      <SecurityCard />

      {/* Sin IA no hay producto, y explica por qué una pregunta no encuentra nada. */}
      <AiConfigurationCard canAdmin={canAdmin} />

      {/* Justo debajo de la clave: es el gasto de esa clave, y es de la empresa. */}
      <AiUsageCard canAdmin={canAdmin} organizationId={organizationId} />

      {/* Después, y no al final de la pantalla: quien acaba de dar su clave de IA es
          exactamente quien se está preguntando qué sale de su empresa. */}
      <PrivacyCard
        organizationId={organizationId}
        organizationName={organization.data?.name ?? null}
        isOwner={role === 'OWNER'}
      />

      <Card title={t('settings.org.title')}>
        <ErrorNote error={organization.error} />
        {organization.data && (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500">{t('settings.org.name')}</dt>
              <dd>{organization.data.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">{t('settings.org.slug')}</dt>
              <dd className="font-mono text-xs">{organization.data.slug}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">
                {t('settings.org.yourRole')}
              </dt>
              <dd>
                <Badge>{labels.role(role ?? null)}</Badge>
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <Card
        title={t('settings.members.title', {
          count: members.data?.length ?? 0,
        })}
      >
        <ErrorNote error={members.error} />
        {members.loading && <Empty>{t('common.loading')}</Empty>}
        {(members.data?.length ?? 0) > 0 && (
          <Table
            head={[
              t('settings.members.column.name'),
              t('settings.members.column.email'),
              t('settings.members.column.role'),
            ]}
          >
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
                  <Badge>{labels.role(member.role)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canAdmin && (
        <ReliabilityCard
          organizationId={organizationId}
          onSaved={organization.reload}
        />
      )}

      {canAdmin && (
        <InviteCard
          organizationId={organizationId}
          onInvited={members.reload}
        />
      )}

      {canAdmin && (
        <Card title={t('settings.access.title')}>
          <p className="mb-3 text-xs text-gray-500">
            {t('settings.access.explain')}
          </p>

          <ErrorNote error={collections.error} />
          {(collections.data?.length ?? 0) === 0 && (
            <Empty>{t('settings.access.noCollections')}</Empty>
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
 * Cuánto exige la empresa a sus fuentes.
 *
 * Es el listón por debajo del cual BusinessBrain considera que un documento ha dejado de ser
 * fiable y lo señala para que alguien lo revise. No es un ajuste técnico: una asesoría o una
 * clínica lo ponen alto porque trabajar con una versión vieja les cuesta caro, y una empresa
 * con documentación estable lo deja bajo.
 *
 * Es además lo que hace que un análisis encuentre algo: sin listón, todo parece correcto.
 */
function ReliabilityCard({
  organizationId,
  onSaved,
}: {
  organizationId: string | null;
  onSaved: () => void;
}) {
  const t = useT();
  const [floor, setFloor] = useState('');
  const [saved, setSaved] = useState(false);
  const action = useAction();

  return (
    <Card title={t('settings.reliability.title')}>
      <p className="mb-3 text-xs text-gray-500">
        {t('settings.reliability.explain')}
      </p>

      <ErrorNote error={action.error} />

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={action.onSubmit(async () => {
          await api(`/organizations/${organizationId}`, {
            method: 'PATCH',
            body: {
              settings: {
                knowledgeEngine: {
                  confidence: { minimumFloor: Number(floor) },
                },
              },
            },
          });
          setSaved(true);
          onSaved();
        })}
      >
        <div className="min-w-40">
          <Field label={t('settings.reliability.field')}>
            <input
              type="number"
              step="0.05"
              min="0"
              max="0.99"
              className={inputClass}
              value={floor}
              onChange={(event) => {
                setFloor(event.target.value);
                setSaved(false);
              }}
              placeholder="0.7"
              required
            />
          </Field>
        </div>
        <Button type="submit" disabled={action.busy}>
          {t('settings.reliability.save')}
        </Button>
        {saved && (
          <span className="text-xs text-green-700">
            {t('settings.reliability.saved')}
          </span>
        )}
      </form>
    </Card>
  );
}

/**
 * Invitar a alguien de la empresa.
 *
 * ## Por qué es un enlace y no un correo
 *
 * El correo saliente existe hoy para una sola cosa: recuperar la contraseña. Montar el envío de
 * invitaciones encima —con su plantilla, su seguimiento y sus rebotes— es otra pieza, y a
 * medias sería peor que no tenerla. Se entrega el enlace para copiar y pegar por donde la
 * empresa ya se comunica.
 *
 * El enlace no es un permiso en blanco: al aceptarlo, el backend exige que el correo de quien
 * acepta COINCIDA con el invitado, así que reenviarlo a otra persona no le da acceso.
 */
function InviteCard({
  organizationId,
  onInvited,
}: {
  organizationId: string | null;
  onInvited: () => void;
}) {
  const t = useT();
  const labels = useLabels();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('MEMBER');
  const [link, setLink] = useState<string | null>(null);
  const action = useAction();

  return (
    <Card title={t('settings.invite.title')}>
      <p className="mb-3 text-xs text-gray-500">{t('settings.invite.explain')}</p>

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
          <Field label={t('settings.invite.email')}>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('settings.invite.emailPlaceholder')}
              required
            />
          </Field>
        </div>
        <div className="min-w-40">
          <Field
            label={t('settings.invite.role')}
            hint={t('settings.invite.roleHint')}
          >
            <select
              aria-label={t('settings.invite.role')}
              className={inputClass}
              value={role}
              onChange={(event) =>
                setRole(event.target.value as MembershipRole)
              }
            >
              <option value="VIEWER">{labels.role('VIEWER')}</option>
              <option value="MEMBER">{labels.role('MEMBER')}</option>
              <option value="ADMIN">{labels.role('ADMIN')}</option>
            </select>
          </Field>
        </div>
        <Button type="submit" disabled={action.busy}>
          {t('settings.invite.submit')}
        </Button>
      </form>

      {link && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-600">
            {t('settings.invite.linkTitle')}
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
  const t = useT();
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
      {/* El nombre de la colección lo puso la empresa: se muestra tal cual. */}
      <p className="text-sm font-medium">{collection.name}</p>

      <ul className="mt-2 flex flex-wrap gap-2">
        {granted.data?.map((grant) => (
          <li key={grant.userId} className="flex items-center gap-1">
            <Badge tone="good">
              {grant.user?.name ?? grant.user?.email ?? grant.userId}
            </Badge>
            <button
              type="button"
              title={t('settings.access.revokeTitle')}
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
              {t('settings.access.revoke')}
            </button>
          </li>
        ))}
        {(granted.data?.length ?? 0) === 0 && !granted.loading && (
          <li className="text-xs text-gray-500">
            {t('settings.access.nobody')}
          </li>
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
          <Field label={t('settings.access.grantTo')}>
            <select
              className={inputClass}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            >
              <option value="">{t('settings.access.choose')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user?.name} ({member.user?.email})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={action.busy}>
          {t('settings.access.grant')}
        </Button>
      </form>

      <ErrorNote error={action.error ?? granted.error} />
    </li>
  );
}
