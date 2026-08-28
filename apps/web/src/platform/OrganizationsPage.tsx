import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useResource } from '../components/ui';
import { useT } from '../i18n';
import {
  Cell,
  DataState,
  DataTable,
  PageHeader,
  Row,
  Section,
  StatusPill,
  useDateFormat,
} from './ui';
import type { Paged, PlanTier, PlatformOrganization } from './types';

/**
 * La cartera de clientes.
 *
 * ## Búsqueda y orden se hacen AQUÍ, y hay que decir por qué
 *
 * La API pagina de veinte en veinte y no acepta ni búsqueda ni ordenación. Podría haberse
 * añadido —era la Fase 5— y no se hizo, así que filtrar aquí opera sobre la página cargada, no
 * sobre el total. **Eso se dice en la pantalla** cuando hay más de una página: una búsqueda que
 * dice "sin resultados" mientras el cliente existe en la página siguiente es peor que no tener
 * búsqueda, porque quien la usa concluye que ese cliente no existe.
 *
 * Es una limitación honesta y visible, no un truco. Cuando la API acepte `?query=`, esto se
 * cambia por una llamada y el aviso desaparece.
 *
 * ## Y lo que esta tabla NO enseña
 *
 * Nada de dentro de ninguna empresa. Los recuentos dicen cuánto material maneja un cliente
 * —señal de si está usando el producto— y ni uno de los títulos, ni una fuente por su nombre,
 * ni una línea de texto. Para eso hace falta abrir la ficha y pedir acceso.
 */
export function PlatformOrganizationsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { date } = useDateFormat();

  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState<PlanTier | ''>('');

  const organizations = useResource<Paged<PlatformOrganization>>(
    useCallback(
      () =>
        api<Paged<PlatformOrganization>>(
          `/platform/organizations?page=${page}`,
          { withoutOrganization: true },
        ),
      [page],
    ),
    [page],
  );

  const visibles = useMemo(() => {
    const items = organizations.data?.items ?? [];
    const buscado = query.trim().toLowerCase();

    return items.filter((org) => {
      const coincide =
        buscado.length === 0 ||
        org.name.toLowerCase().includes(buscado) ||
        org.slug.toLowerCase().includes(buscado);
      return coincide && (plan === '' || org.planTier === plan);
    });
  }, [organizations.data, query, plan]);

  const filtrando = query.trim().length > 0 || plan !== '';
  const hayMasPaginas = (organizations.data?.pages ?? 1) > 1;

  return (
    <>
      <PageHeader
        title={t('platform.organizations.title')}
        description={t('platform.organizations.subtitle')}
      />

      <Section>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[200px]">
            <span className="mb-1 block text-[12px] font-medium text-ink">
              {t('platform.organizations.search')}
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('platform.organizations.searchPlaceholder')}
              className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13.5px] outline-none focus:border-gray-500"
            />
          </label>

          <label>
            <span className="mb-1 block text-[12px] font-medium text-ink">
              {t('platform.organizations.plan')}
            </span>
            <select
              value={plan}
              onChange={(event) => setPlan(event.target.value as PlanTier | '')}
              className="rounded border border-line bg-white px-2.5 py-1.5 text-[13.5px] outline-none focus:border-gray-500"
            >
              <option value="">{t('platform.organizations.allPlans')}</option>
              {(['FREE', 'PRO', 'ENTERPRISE'] as const).map((option) => (
                <option key={option} value={option}>
                  {t(`platform.plan.${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/*
          La honestidad de la que habla la cabecera del fichero. Solo cuando hay más de una
          página: con una sola, filtrar aquí y filtrar en el servidor dan lo mismo.
        */}
        {filtrando && hayMasPaginas && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            {t('platform.organizations.searchScope')}
          </p>
        )}

        <DataState
          loading={organizations.loading}
          error={organizations.error}
          empty={visibles.length === 0}
          emptyMessage={
            filtrando
              ? t('platform.organizations.noMatches')
              : t('platform.organizations.none')
          }
          onRetry={organizations.reload}
        >
          <DataTable
            head={[
              t('platform.organizations.column.name'),
              t('platform.organizations.column.plan'),
              t('platform.organizations.column.people'),
              t('platform.organizations.column.documents'),
              t('platform.organizations.column.sources'),
              t('platform.organizations.column.since'),
            ]}
          >
            {visibles.map((org) => (
              <Row
                key={org.id}
                onOpen={() => navigate(`/platform/organizations/${org.id}`)}
              >
                <Cell>
                  <span className="font-medium">{org.name}</span>
                  <span className="ml-2 text-[12px] text-muted">
                    {org.slug}
                  </span>
                </Cell>
                <Cell>
                  <StatusPill tone={org.planTier === 'FREE' ? 'quiet' : 'neutral'}>
                    {t(`platform.plan.${org.planTier}`)}
                  </StatusPill>
                </Cell>
                <Cell numeric>{org._count.memberships}</Cell>
                <Cell numeric>{org._count.knowledgeItems}</Cell>
                <Cell numeric>{org._count.knowledgeSources}</Cell>
                <Cell muted>{date(org.createdAt)}</Cell>
              </Row>
            ))}
          </DataTable>
        </DataState>

        {organizations.data && organizations.data.pages > 1 && (
          <Pagination
            page={organizations.data.page}
            pages={organizations.data.pages}
            onChange={setPage}
          />
        )}
      </Section>
    </>
  );
}

export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  const t = useT();

  return (
    <nav
      aria-label={t('platform.pagination.label')}
      className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[12.5px]"
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded border border-line px-2.5 py-1 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
      >
        {t('platform.pagination.previous')}
      </button>
      <span className="text-muted">
        {t('platform.pagination.position', { page, pages })}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pages}
        className="rounded border border-line px-2.5 py-1 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
      >
        {t('platform.pagination.next')}
      </button>
    </nav>
  );
}
