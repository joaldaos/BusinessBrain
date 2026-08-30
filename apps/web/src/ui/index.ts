/**
 * El sistema visual de BusinessBrain. Un solo sitio, cliente y plataforma.
 *
 * `components/ui.tsx` y `platform/ui.tsx` reexportan desde aquí en vez de tener sus propias
 * versiones: así las pantallas antiguas siguen compilando mientras heredan el aspecto nuevo,
 * y no queda ningún camino por el que volver a tener dos escalas tipográficas.
 */
export {
  Button,
  Section,
  PageHeader,
  Metric,
  StatusPill,
  Field,
  fieldClass,
  DataTable,
  Row,
  Cell,
  type Tone,
} from './primitives';

export { DataState, EmptyState, ErrorNote, Skeleton } from './states';
export { usePageTitle } from './use-page-title';
