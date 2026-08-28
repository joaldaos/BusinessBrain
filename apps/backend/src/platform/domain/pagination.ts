/**
 * Paginación de la superficie de plataforma.
 *
 * Vive aquí y no repetida en cada servicio porque la corrección que importa es una sola y
 * fácil de olvidar: `page=abc` llega como `NaN` tras `Number()`, y sin este ajuste Prisma
 * recibe un `skip` inválido y responde 500. Un 500 por una cadena en la barra de direcciones
 * no es solo feo — es información sobre las tripas del sistema que no hacía falta dar.
 */

export const PAGE_SIZE = 20;

export function normalizePage(page?: number): number {
  return Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export function paginate<T>(items: T[], total: number, page: number): Page<T> {
  return { items, total, page, pages: Math.ceil(total / PAGE_SIZE) };
}
