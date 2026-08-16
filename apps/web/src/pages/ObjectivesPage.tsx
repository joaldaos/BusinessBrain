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
  formatDate,
  inputClass,
  useAction,
  useResource,
} from '../components/ui';

/**
 * Objetivos de negocio.
 *
 * No son decorativos: **un hallazgo no puede clasificarse como riesgo u oportunidad si no hay
 * un objetivo confirmado que lo haga relevante** (§8). Sin objetivos, el motor solo produce
 * patrones y anomalías — describe lo que pasa, pero no dice si importa.
 *
 * Un objetivo declarado a mano nace ya confirmado: lo dijo una persona. Uno inferido por el
 * sistema nace como candidato y necesita que alguien lo confirme antes de poder anclar nada.
 */
export function ObjectivesPage() {
  const objectives = useResource(() =>
    api<BusinessObjective[]>('/business-objectives'),
  );
  const [statement, setStatement] = useState('');
  const create = useAction();
  const decide = useAction();

  return (
    <>
      <Card title="Declarar un objetivo">
        <p className="mb-3 text-xs text-gray-500">
          Sin un objetivo confirmado, el sistema puede decirte qué está pasando,
          pero no si eso es un riesgo o una oportunidad para tu empresa.
        </p>

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
            <Field label="Objetivo">
              <input
                className={inputClass}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="El margen comercial no debe bajar del 30 %."
                required
              />
            </Field>
          </div>
          <Button type="submit" disabled={create.busy}>
            Declarar
          </Button>
        </form>

        <ErrorNote error={create.error} />
      </Card>

      <Card title={`Objetivos (${objectives.data?.length ?? 0})`}>
        <ErrorNote error={objectives.error ?? decide.error} />
        {objectives.loading && <Empty>Cargando…</Empty>}
        {!objectives.loading && (objectives.data?.length ?? 0) === 0 && (
          <Empty>Ninguno declarado todavía.</Empty>
        )}

        {(objectives.data?.length ?? 0) > 0 && (
          <Table head={['Objetivo', 'Estado', 'Origen', 'Declarado', '']}>
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
                      ? 'confirmado'
                      : objective.status === 'INFERRED'
                        ? 'propuesto por el sistema'
                        : objective.status}
                  </Badge>
                </td>
                <td className="px-2 py-2 text-xs text-gray-600">
                  {objective.origin === 'MANUAL_DECLARATION'
                    ? 'una persona'
                    : 'inferido'}
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
                      Confirmar
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
                      Descartar
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
