import { useI18n, useT } from "../i18n";

/**
 * Lo propio del panel de operación.
 *
 * ## Aquí ya no vive el sistema visual
 *
 * Vivía. Este fichero fue el mejor sistema de diseño del producto durante dos fases, y por eso
 * es el que se promovió a `src/ui` en vez de inventar un tercero. Lo que queda son las dos
 * cosas que solo el panel necesita: cómo se dicen las fechas de una concesión y cuánto le
 * queda de vida.
 *
 * El panel mantiene su carácter —cabecera oscura, distintivo de operación— pero las piezas son
 * ya las mismas que las del producto de cliente. Que administrar BusinessBrain se vea distinto
 * de usarlo es cuestión del marco, no de tener otra tipografía.
 */

export {
  Button as ActionButton,
  Section,
  PageHeader,
  Metric,
  StatusPill,
  Field,
  fieldClass,
  DataTable,
  Row,
  Cell,
  DataState,
  EmptyState,
  Skeleton,
  usePageTitle,
  type Tone,
} from "../ui";

/**
 * Fechas en el formato del idioma activo, con el mes escrito.
 *
 * `dateStyle: 'short'` daba `30/8/26`. En una traza de auditoría que alguien puede tener que
 * leer meses después, un año a dos cifras y un mes en número son exactamente la clase de dato
 * que se interpreta mal.
 */
export function useDateFormat() {
  const { locale } = useI18n();

  return {
    dateTime: (value: string | null | undefined) =>
      value
        ? new Date(value).toLocaleString(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "—",
    date: (value: string | null | undefined) =>
      value
        ? new Date(value).toLocaleDateString(locale, { dateStyle: "medium" })
        : "—",
  };
}

/**
 * "Caduca en 3 horas" en vez de una marca de tiempo.
 *
 * Para decidir si hace falta pedir otra concesión, lo que importa es cuánto queda, no en qué
 * instante exacto termina. La fecha completa se enseña al lado, para quien la necesite.
 */
export function useRelativeDeadline() {
  const { locale } = useI18n();
  const t = useT();

  return (value: string): string => {
    const restantes = new Date(value).getTime() - Date.now();
    if (restantes <= 0) return t("platform.grant.expiredAlready");

    const formato = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const horas = Math.round(restantes / 3_600_000);

    return horas >= 24
      ? formato.format(Math.round(horas / 24), "day")
      : formato.format(Math.max(horas, 1), "hour");
  };
}
