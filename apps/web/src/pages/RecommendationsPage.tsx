import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { hasRole, type Recommendation } from '../api/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  formatDate,
  useAction,
  useResource,
} from '../components/ui';

/**
 * Lo que BusinessBrain propone, y lo que la empresa decide.
 *
 * ## Por qué esta pantalla es el otro medio producto
 *
 * Preguntar es reactivo: hay que saber qué preguntar. Esto es lo contrario — el sistema mira lo
 * que sabe y dice "esto deberías revisarlo". Es la diferencia entre una herramienta que
 * consultas y una que trabaja para ti.
 *
 * ## Proponer no es hacer
 *
 * La pantalla lo dice explícitamente y en más de un sitio, porque es la garantía que sostiene
 * la confianza: aceptar registra una decisión y **no ejecuta nada**. Ni correos, ni cambios en
 * documentos, ni llamadas a terceros. Si algún día eso cambiara, tendría que cambiar aquí
 * primero.
 *
 * ## Quién la escribió importa
 *
 * Una propuesta del sistema y una redactada por un compañero no se leen igual. Se distinguen
 * siempre: presentar ambas como "recomendación" a secas ocultaría de quién es el criterio.
 */
export function RecommendationsPage() {
  const { role } = useAuth();
  const canDecide = hasRole(role, 'MEMBER');
  const [showResolved, setShowResolved] = useState(false);

  const pending = useResource(() =>
    api<Recommendation[]>('/recommendations?status=NEW'),
  );
  const resolved = useResource(
    () =>
      showResolved
        ? api<Recommendation[]>('/recommendations')
        : Promise.resolve([]),
    [showResolved],
  );

  const decided = (resolved.data ?? []).filter(
    (recommendation) => recommendation.status !== 'NEW',
  );

  return (
    <>
      <Card title={`Pendientes de tu decisión (${pending.data?.length ?? 0})`}>
        <p className="mb-3 text-xs text-gray-500">
          BusinessBrain te propone; decides tú. Aceptar deja constancia de la
          decisión — <strong>no ejecuta ninguna acción</strong> ni cambia nada
          fuera de aquí.
        </p>

        <ErrorNote error={pending.error} />
        {pending.loading && <Empty>Cargando…</Empty>}
        {!pending.loading && (pending.data?.length ?? 0) === 0 && (
          <Empty>
            No hay nada pendiente. Cuando un análisis encuentre algo que merezca
            una acción, aparecerá aquí.
          </Empty>
        )}

        <ul className="space-y-3">
          {pending.data?.map((recommendation) => (
            <RecommendationCard
              key={recommendation.id}
              recommendation={recommendation}
              canDecide={canDecide}
              onDecided={() => {
                pending.reload();
                resolved.reload();
              }}
            />
          ))}
        </ul>
      </Card>

      <Card title="Decisiones anteriores">
        <Button
          variant="secondary"
          onClick={() => setShowResolved(!showResolved)}
        >
          {showResolved ? 'Ocultar' : 'Ver decisiones anteriores'}
        </Button>

        {showResolved && (
          <>
            <ErrorNote error={resolved.error} />
            {decided.length === 0 && !resolved.loading && (
              // Descartar no borra: si no hay nada es que aún no se ha decidido nada.
              <Empty>Todavía no has aceptado ni descartado ninguna.</Empty>
            )}
            <ul className="mt-3 space-y-2">
              {decided.map((recommendation) => (
                <li
                  key={recommendation.id}
                  className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 pb-2 text-sm last:border-0"
                >
                  <Badge
                    tone={
                      recommendation.status === 'ACCEPTED' ? 'good' : 'neutral'
                    }
                  >
                    {recommendation.status === 'ACCEPTED'
                      ? 'aceptada'
                      : 'descartada'}
                  </Badge>
                  <span>{recommendation.title}</span>
                  <span className="text-xs text-gray-500">
                    {recommendation.resolvedBy?.name ?? 'alguien'} ·{' '}
                    {formatDate(recommendation.resolvedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

function RecommendationCard({
  recommendation,
  canDecide,
  onDecided,
}: {
  recommendation: Recommendation;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const action = useAction();

  const decide = (decision: 'accept' | 'dismiss') =>
    void action
      .run(() =>
        api(`/recommendations/${recommendation.id}/${decision}`, {
          method: 'POST',
        }),
      )
      .then(onDecided);

  return (
    <li className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">{recommendation.title}</h3>
        {/* De quién es el criterio. Una propuesta del sistema y una de un compañero no se
            leen igual. */}
        <Badge tone={recommendation.createdById ? 'neutral' : 'good'}>
          {recommendation.createdById
            ? 'propuesta por una persona'
            : 'propuesta por BusinessBrain'}
        </Badge>
        <span className="text-xs text-gray-500">
          {formatDate(recommendation.createdAt)}
        </span>
      </div>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Qué hemos detectado" value={recommendation.detected} />
        <Field label="Por qué importa" value={recommendation.justification} />
        <Field label="Impacto esperado" value={recommendation.estimatedImpact} />
        <Field label="Áreas afectadas" value={recommendation.affectedAreas} />
        <Field label="A favor" value={recommendation.advantages} />
        <Field label="En contra" value={recommendation.drawbacks} />
        <div className="sm:col-span-2">
          <Field label="Por dónde empezar" value={recommendation.migrationPlan} />
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setShowEvidence(!showEvidence)}>
          {showEvidence ? 'Ocultar evidencia' : 'Ver evidencia'}
        </Button>

        {canDecide && (
          <>
            <Button disabled={action.busy} onClick={() => decide('accept')}>
              {action.busy ? 'Guardando…' : 'Aceptar'}
            </Button>
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() => decide('dismiss')}
            >
              Descartar
            </Button>
          </>
        )}
        {!canDecide && (
          <span className="text-xs text-gray-500">
            Solo lectura: pide a un compañero con permisos que decida.
          </span>
        )}
      </div>

      <ErrorNote error={action.error} />

      {showEvidence && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs">
          <p className="font-medium text-gray-700">
            ¿Por qué me propones esto?
          </p>
          {recommendation.sourceInsight ? (
            <p className="mt-1 text-gray-600">
              Sale de esta conclusión:{' '}
              <Link
                className="underline"
                to={`/insights/${recommendation.sourceInsight.id}`}
              >
                {recommendation.sourceInsight.summary}
              </Link>{' '}
              <span className="text-gray-500">
                (confianza{' '}
                {recommendation.sourceInsight.confidence.toFixed(2)}) — ábrela
                para ver los documentos en los que se apoya.
              </span>
            </p>
          ) : (
            <p className="mt-1 text-amber-700">
              La conclusión que la originó ya no está disponible.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-xs uppercase text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-800">{value}</dd>
    </div>
  );
}
