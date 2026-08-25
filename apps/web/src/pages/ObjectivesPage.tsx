import { useState } from 'react';
import { api } from '../api/client';
import type { BusinessObjective } from '../api/types';
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
  useFormatDate,
  useResource,
} from '../components/ui';
import { useT } from '../i18n';

/**
 * Objetivos de negocio.
 *
 * No son decorativos: **un hallazgo no puede clasificarse como riesgo u oportunidad si no hay
 * un objetivo confirmado que lo haga relevante** (§8). Sin objetivos, el motor solo produce
 * patrones y anomalías — describe lo que pasa, pero no dice si importa.
 *
 * Un objetivo declarado a mano nace ya confirmado: lo dijo una persona. Uno inferido por el
 * sistema nace como candidato y necesita que alguien lo confirme antes de poder anclar nada.
 *
 * El ENUNCIADO lo escribe la empresa y se muestra tal cual, en el idioma en que lo escribió:
 * traducirlo cambiaría lo que la empresa dijo que quería.
 */
export function ObjectivesPage() {
  const t = useT();
  const formatDate = useFormatDate();
  const objectives = useResource(() =>
    api<BusinessObjective[]>('/business-objectives'),
  );
  const [statement, setStatement] = useState('');
  const create = useAction();
  const decide = useAction();

  return (
    <>
      <Card title={t('objectives.declare.title')}>
        <p className="mb-3 text-xs text-gray-500">{t('objectives.declare.why')}</p>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={create.onSubmit(async () => {
            await api('/business-objectives', {
              method: 'POST',
              body: { statement },
            });
            setStatement('');
            objectives.reload();
          })}
        >
          <div className="min-w-64 flex-1">
            <Field label={t('objectives.field')}>
              <input
                className={inputClass}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder={t('objectives.placeholder')}
                required
              />
            </Field>
          </div>
          <Button type="submit" disabled={create.busy}>
            {t('objectives.declare')}
          </Button>
        </form>

        <ErrorNote error={create.error} />
      </Card>

      <Card
        title={t('objectives.title', { count: objectives.data?.length ?? 0 })}
      >
        <ErrorNote error={objectives.error ?? decide.error} />
        {objectives.loading && <Empty>{t('common.loading')}</Empty>}
        {!objectives.loading && (objectives.data?.length ?? 0) === 0 && (
          <Empty>{t('objectives.empty')}</Empty>
        )}

        {(objectives.data?.length ?? 0) > 0 && (
          <Table
            head={[
              t('objectives.column.statement'),
              t('objectives.column.status'),
              t('objectives.column.origin'),
              t('objectives.column.declared'),
              '',
            ]}
          >
            {objectives.data?.map((objective) => (
              <tr
                key={objective.id}
                className="border-b border-gray-100 last:border-0"
              >
                <td className="px-2 py-2">{objective.statement}</td>
                <td className="px-2 py-2">
                  <Badge
                    tone={objective.status === 'CONFIRMED' ? 'good' : 'warn'}
                  >
                    {objective.status === 'CONFIRMED'
                      ? t('objectives.status.confirmed')
                      : objective.status === 'INFERRED'
                        ? t('objectives.status.inferred')
                        : objective.status}
                  </Badge>
                </td>
                <td className="px-2 py-2 text-xs text-gray-600">
                  {objective.origin === 'MANUAL_DECLARATION'
                    ? t('objectives.origin.person')
                    : t('objectives.origin.inferred')}
                </td>
                <td className="px-2 py-2 text-xs text-gray-600">
                  {formatDate(objective.createdAt)}
                </td>
                <td className="px-2 py-2 text-right">
                  {objective.status === 'INFERRED' && (
                    <Button
                      variant="secondary"
                      disabled={decide.busy}
                      onClick={() =>
                        void decide
                          .run(() =>
                            api(
                              `/business-objectives/${objective.id}/confirm`,
                              { method: 'POST' },
                            ),
                          )
                          .then(objectives.reload)
                      }
                    >
                      {t('objectives.confirm')}
                    </Button>
                  )}
                  {objective.status === 'CONFIRMED' && (
                    <Button
                      variant="danger"
                      disabled={decide.busy}
                      onClick={() =>
                        void decide
                          .run(() =>
                            api(
                              `/business-objectives/${objective.id}/discard`,
                              { method: 'POST' },
                            ),
                          )
                          .then(objectives.reload)
                      }
                    >
                      {t('objectives.discard')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
