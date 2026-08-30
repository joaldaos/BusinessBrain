import { useState } from 'react';
import { api } from '../api/client';
import { AiConfigurationCard } from '../components/AiConfigurationCard';
import { AiUsageCard } from '../components/AiUsageCard';
import { PrivacyCard } from '../components/PrivacyCard';
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
  Section,
  PageHeader,
  usePageTitle,
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
  // El título de la pestaña es corto a propósito: con cuatro pestañas abiertas, lo que hay
  // que distinguir es la sección, no leer una frase.
  usePageTitle('nav.settings');

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

  const secciones: Seccion[] = [
    { id: 'ia', label: 'settings.section.ai' },
    { id: 'privacidad', label: 'settings.section.privacy' },
    { id: 'empresa', label: 'settings.section.company' },
    { id: 'equipo', label: 'settings.section.team' },
  ];
  const [activa, setActiva] = useState<Seccion['id']>('ia');

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.subtitle')}
      />

      <div className="grid gap-6 lg:grid-cols-[13rem_1fr] lg:items-start">
        {/*
          Navegación lateral en escritorio, pestañas horizontales en móvil. Antes esto eran
          doce tarjetas apiladas en tres mil píxeles: encontrar el tope de gasto exigía
          recorrer el aviso de privacidad entero.
        */}
        <nav
          aria-label={t('settings.title')}
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible"
        >
          {secciones.map((seccion) => (
            <button
              key={seccion.id}
              type="button"
              onClick={() => setActiva(seccion.id)}
              aria-current={activa === seccion.id ? 'page' : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-left t-small transition-colors ${
                activa === seccion.id
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-muted hover:bg-sunken hover:text-ink'
              }`}
            >
              {t(seccion.label)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {activa === 'ia' && (
            <>
              {/* Sin IA no hay producto, y explica por qué una pregunta no encuentra nada. */}
              <AiConfigurationCard canAdmin={canAdmin} />
              {/* Justo debajo de la clave: es el gasto de esa clave, y es de la empresa. */}
              <AiUsageCard canAdmin={canAdmin} organizationId={organizationId} />
            </>
          )}

          {activa === 'privacidad' && (
            <PrivacyCard
              organizationId={organizationId}
              organizationName={organization.data?.name ?? null}
              isOwner={role === 'OWNER'}
            />
          )}

          {activa === 'empresa' && (
            <>
              <Section title={t('settings.org.title')}>
                <ErrorNote error={organization.error} />
                {organization.data && (
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="t-micro text-muted">{t('settings.org.name')}</dt>
                      <dd className="mt-1 t-body">{organization.data.name}</dd>
                    </div>
                    <div>
                      <dt className="t-micro text-muted">{t('settings.org.slug')}</dt>
                      <dd className="mt-1 font-mono t-small text-muted">
                        {organization.data.slug}
                      </dd>
                    </div>
                    <div>
                      <dt className="t-micro text-muted">
                        {t('settings.org.yourRole')}
                      </dt>
                      <dd className="mt-1">
                        <Badge>{labels.role(role ?? null)}</Badge>
                      </dd>
                    </div>
                  </dl>
                )}
              </Section>

              {canAdmin && (
                <ReliabilityCard
                  organizationId={organizationId}
                  onSaved={organization.reload}
                />
              )}
            </>
          )}

          {activa === 'equipo' && (
            <>
              <Section
                title={t('settings.members.title', {
                  count: members.data?.length ?? 0,
                })}
                flush
              >
                <div className="px-5 pb-5">
                  <ErrorNote error={members.error} />
                </div>
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
                      <tr key={member.userId}>
                        <td className="px-5 py-3 t-body">
                          {member.user?.name ?? '—'}
                        </td>
                        <td className="px-5 py-3 t-body text-muted">
                          {member.user?.email ?? '—'}
                        </td>
                        <td className="px-5 py-3">
                          <Badge>{labels.role(member.role)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Section>

              {canAdmin && (
                <InviteCard
                  organizationId={organizationId}
                  onInvited={members.reload}
                />
              )}

              {canAdmin && (
                <Section
                  title={t('settings.access.title')}
                  description={t('settings.access.explain')}
                >
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
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Las cuatro áreas de la configuración de una empresa. */
interface Seccion {
  id: 'ia' | 'privacidad' | 'empresa' | 'equipo';
  label: Parameters<ReturnType<typeof useT>>[0];
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
    <Section title={t('settings.reliability.title')}>
      <p className="mb-3 t-fine text-muted">
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
          <span className="t-fine text-positive">
            {t('settings.reliability.saved')}
          </span>
        )}
      </form>
    </Section>
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
    <Section title={t('settings.invite.title')}>
      <p className="mb-3 t-fine text-muted">{t('settings.invite.explain')}</p>

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
        <div className="mt-3 rounded border border-line bg-sunken p-3">
          <p className="t-fine text-muted">
            {t('settings.invite.linkTitle')}
          </p>
          <code className="mt-1 block break-all t-fine">{link}</code>
        </div>
      )}
    </Section>
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
    <li className="rounded border border-line p-3">
      {/* El nombre de la colección lo puso la empresa: se muestra tal cual. */}
      <p className="t-small font-medium">{collection.name}</p>

      <ul className="mt-2 flex flex-wrap gap-2">
        {granted.data?.map((grant) => (
          <li key={grant.userId} className="flex items-center gap-1">
            <Badge tone="good">
              {grant.user?.name ?? grant.user?.email ?? grant.userId}
            </Badge>
            <button
              type="button"
              title={t('settings.access.revokeTitle')}
              className="t-fine text-danger underline"
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
          <li className="t-fine text-muted">
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
