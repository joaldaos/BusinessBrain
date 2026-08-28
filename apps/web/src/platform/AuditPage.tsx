import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { useResource } from '../components/ui';
import { useI18n, useT, type TranslationKey } from '../i18n';
import { Pagination } from './OrganizationsPage';
import {
  DataState,
  PageHeader,
  Section,
  StatusPill,
  useDateFormat,
} from './ui';
import type { AuditEntry, Paged } from './types';

/**
 * La traza de lo que ha hecho la administración de BusinessBrain.
 *
 * ## Por qué NO es una tabla
 *
 * Una tabla obliga a que cada fila tenga las mismas columnas, y aquí no las tienen: un cambio
 * de plan dice "de gratuito a profesional", una retirada de segundo factor lleva un motivo
 * escrito a mano, y una consulta de datos dice qué se consultó. Metido todo en columnas fijas,
 * o sobran columnas vacías o el detalle acaba en una celda ilegible.
 *
 * Cada entrada se lee como una frase: **quién, qué, sobre qué empresa, cuándo**, y debajo el
 * detalle que esa acción concreta dejó. Es lo que hay que poder leer seis meses después
 * cuando un cliente pregunta.
 *
 * ## Lo que aquí no aparece nunca
 *
 * El correo del actor —la API devuelve nombre, no correo—, ningún secreto, ningún token y
 * ninguna acción de cliente. El filtro por acción se construye con el catálogo cerrado que
 * devuelve la propia API, no con una lista escrita aquí: si el backend añade una acción
 * administrativa, aparece; si alguien intenta filtrar por una acción de cliente, no existe la
 * opción.
 *
 * ## Y leer esto no deja rastro
 *
 * Decisión de la Fase 2, y sigue en pie: si cada lectura escribiera una entrada, la siguiente
 * lectura devolvería sobre todo entradas de lecturas anteriores, y las acciones de verdad
 * quedarían enterradas bajo el ruido de mirarlas.
 */
export function PlatformAuditPage() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [code, setCode] = useState('');

  const actions = useResource<string[]>(
    useCallback(
      () =>
        api<string[]>('/platform/audit/actions', {
          withoutOrganization: true,
        }),
      [],
    ),
  );

  const entries = useResource<Paged<AuditEntry>>(
    useCallback(
      () =>
        api<Paged<AuditEntry>>(
          `/platform/audit?page=${page}${code ? `&code=${encodeURIComponent(code)}` : ''}`,
          { withoutOrganization: true },
        ),
      [page, code],
    ),
    [page, code],
  );

  return (
    <>
      <PageHeader
        title={t('platform.audit.title')}
        description={t('platform.audit.subtitle')}
      />

      <Section>
        <label className="mb-5 block max-w-sm">
          <span className="mb-1 block text-[12px] font-medium text-ink">
            {t('platform.audit.filterByAction')}
          </span>
          <select
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setPage(1);
            }}
            className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13.5px] outline-none focus:border-gray-500"
          >
            <option value="">{t('platform.audit.allActions')}</option>
            {(actions.data ?? []).map((action) => (
              <option key={action} value={action}>
                {translateAction(t, action)}
              </option>
            ))}
          </select>
        </label>

        <DataState
          loading={entries.loading}
          error={entries.error}
          empty={(entries.data?.items.length ?? 0) === 0}
          emptyMessage={t('platform.audit.none')}
          onRetry={entries.reload}
        >
          <ol className="divide-y divide-line">
            {(entries.data?.items ?? []).map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ol>
        </DataState>

        {entries.data && entries.data.pages > 1 && (
          <Pagination
            page={entries.data.page}
            pages={entries.data.pages}
            onChange={setPage}
          />
        )}
      </Section>
    </>
  );
}

function Entry({ entry }: { entry: AuditEntry }) {
  const t = useT();
  const { locale } = useI18n();
  const { dateTime } = useDateFormat();
  const detalles = Object.entries(entry.details);

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13.5px] font-medium text-ink">
          {entry.actor?.name ?? t('platform.audit.system')}
        </span>
        <span className="text-[13.5px] text-ink/80">
          {translateAction(t, entry.code)}
        </span>
        {entry.organization && (
          <StatusPill tone="neutral">
            {entry.organization.name ?? entry.organization.id}
          </StatusPill>
        )}
        <span className="ml-auto whitespace-nowrap text-[12px] tabular-nums text-muted">
          {dateTime(entry.at)}
        </span>
      </div>

      {detalles.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
          {detalles.map(([clave, valor]) => (
            <div key={clave} className="flex gap-1.5">
              <dt className="text-muted">{translateDetail(t, clave)}:</dt>
              <dd className="text-ink/85">
                {presentValue(t, locale, valor)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/**
 * Los códigos se traducen; los que todavía no tienen traducción se enseñan tal cual.
 *
 * `t` devuelve la clave cuando no la conoce, y una clave en pantalla no le dice nada a nadie.
 * El código en bruto es feo, visible y arreglable — que es exactamente lo que hace falta para
 * que alguien lo traduzca. Hay una prueba que impide que un código de plataforma llegue a
 * producción sin traducir en los dos idiomas.
 */
function translateAction(
  t: ReturnType<typeof useT>,
  code: string,
): string {
  const clave = `audit.action.${code}` as TranslationKey;
  const texto = t(clave);
  return texto === clave ? code : texto;
}

function translateDetail(t: ReturnType<typeof useT>, key: string): string {
  const clave = `audit.detail.${key}` as TranslationKey;
  const texto = t(clave);
  return texto === clave ? key : texto;
}

/**
 * Valores conocidos traducidos; el resto tal cual, sin inventar formato.
 *
 * El idioma llega como parámetro y no de un hook: esto se llama dentro de un `map`, y un hook
 * ahí dependería de cuántos detalles traiga cada entrada — que es distinto en cada una.
 */
function presentValue(
  t: ReturnType<typeof useT>,
  locale: string,
  value: unknown,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') {
    return t(value ? 'common.yes' : 'common.no');
  }
  if (typeof value === 'string') {
    const clave = `audit.value.${value}` as TranslationKey;
    const texto = t(clave);
    if (texto !== clave) return texto;
    // Una fecha ISO se enseña en el formato del idioma; el resto, literal.
    return /^\d{4}-\d{2}-\d{2}T/.test(value)
      ? new Date(value).toLocaleString(locale)
      : value;
  }
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}
