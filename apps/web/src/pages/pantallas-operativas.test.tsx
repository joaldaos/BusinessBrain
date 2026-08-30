import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderLocalized } from '../test/render';
import type { Automation, Report } from '../api/types';

/**
 * Lo que estas cuatro pantallas NO pueden enseñar.
 *
 * Son comprobaciones de lenguaje y de permiso, no de aspecto. Un recorrido de navegador ve
 * que la pantalla carga; no ve que dentro ponga `0 8 * * 1` donde debería poner "cada lunes a
 * las ocho", ni que la única frase que recibe alguien sin permiso sea un mensaje de error.
 *
 * La regla del producto es que **la complejidad vive dentro de BusinessBrain, nunca en quien
 * lo usa**. Una expresión de cron en pantalla es esa regla rota, y se rompe sola en cuanto
 * alguien añade un horario nuevo y se olvida de darle nombre.
 */

const peticiones: string[] = [];
let respuestas: Record<string, unknown> = {};

vi.mock('../api/client', () => ({
  api: (ruta: string) => {
    peticiones.push(ruta);
    const clave = Object.keys(respuestas).find((r) => ruta.startsWith(r));
    return Promise.resolve(clave ? respuestas[clave] : []);
  },
  download: () => Promise.reject(new Error('no se usa aquí')),
  ApiError: class extends Error {},
}));

let rol = 'ADMIN';
vi.mock('../auth', () => ({
  useAuth: () => ({ role: rol, organizationId: 'org-1', user: null }),
}));

beforeEach(() => {
  peticiones.length = 0;
  respuestas = {};
  rol = 'ADMIN';
});

// Se importan DESPUÉS de declarar los dobles: al cargarse arrastran `api` y `useAuth`.
const { AnalysisPage } = await import('./AnalysisPage');
const { AutomationsPage } = await import('./AutomationsPage');
const { ReportsPage } = await import('./ReportsPage');

describe('Análisis', () => {
  it('a quien no puede lanzarlo le explica por qué, y no le enseña un error', async () => {
    rol = 'MEMBER';
    renderLocalized(<AnalysisPage />);

    // El encabezado de pantalla existe también por este camino: antes esta rama devolvía una
    // tarjeta suelta y la página se quedaba sin `h1`.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Análisis' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/solo un administrador/i)).toBeInTheDocument();

    // Y no se le ofrece una acción que la API le va a denegar.
    expect(screen.queryByRole('button', { name: /analizar ahora/i })).toBeNull();
    // Ni se piden datos que no va a poder ver: sin permiso, no se llama a la API.
    expect(peticiones).toEqual([]);
  });

  it('sin conocimiento leído dice qué le falta antes de dejar que se pulse a ciegas', async () => {
    // Con enrutador: los avisos de lo que falta llevan su enlace para resolverlo.
    renderLocalized(
      <MemoryRouter>
        <AnalysisPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText(/qué necesita para poder analizar/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/documentos de tu empresa/i)).toBeInTheDocument();
    expect(screen.getByText(/al menos un objetivo/i)).toBeInTheDocument();
  });
});

describe('Automatizaciones', () => {
  const automatizacion = (extra: Partial<Automation> = {}): Automation => ({
    id: 'a1',
    name: 'Barrido semanal',
    triggerType: 'SCHEDULE',
    triggerConfig: { cron: '0 8 * * 1', timezone: 'Europe/Madrid' },
    actions: [{ type: 'RUN_ANALYSIS' }],
    status: 'ACTIVE',
    lastRunAt: null,
    nextRunAt: null,
    _count: { runs: 0 },
    ...extra,
  });

  it('dice cuándo se ejecuta en castellano, no con una expresión de cron', async () => {
    respuestas = { '/automations': [automatizacion()] };
    renderLocalized(<AutomationsPage />);

    await waitFor(() =>
      expect(screen.getByText('Barrido semanal')).toBeInTheDocument(),
    );

    expect(screen.getByText(/cada lunes a las 8:00/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 8 \* \* 1/)).toBeNull();
  });

  it('traduce lo que hace: nunca enseña el nombre interno de la acción', async () => {
    respuestas = { '/automations': [automatizacion()] };
    renderLocalized(<AutomationsPage />);

    await waitFor(() =>
      expect(screen.getByText('analizar')).toBeInTheDocument(),
    );
    expect(screen.queryByText('RUN_ANALYSIS')).toBeNull();
  });

  it('una automatización que nunca se ha ejecutado lo dice, en vez de callarse', async () => {
    respuestas = { '/automations': [automatizacion()] };
    renderLocalized(<AutomationsPage />);

    await waitFor(() =>
      expect(screen.getByText(/todavía no se ha ejecutado/i)).toBeInTheDocument(),
    );
  });

  it('a quien no es administrador no se le ofrece crear ni ejecutar', async () => {
    rol = 'MEMBER';
    respuestas = { '/automations': [automatizacion()] };
    renderLocalized(<AutomationsPage />);

    await waitFor(() =>
      expect(screen.getByText('Barrido semanal')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /crear automatización/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /ejecutar ahora/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pausar/i })).toBeNull();
  });
});

describe('Informes', () => {
  const informe = (secciones: Report['template']['sections']): Report => ({
    id: 'r1',
    name: 'Resumen semanal',
    format: 'PDF',
    template: { sections: secciones },
    createdAt: '2026-08-01T00:00:00.000Z',
    _count: { runs: 3 },
  });

  it('dice qué lleva dentro, no cuántas secciones tiene', async () => {
    respuestas = {
      '/reports': [
        informe([
          { type: 'INSIGHTS', title: 'Qué hemos comprendido', limit: 10 },
          {
            type: 'KNOWLEDGE_SEARCH',
            title: 'Sobre: devoluciones',
            query: 'devoluciones',
            limit: 10,
          },
        ]),
      ],
    };
    renderLocalized(<ReportsPage />);

    await waitFor(() =>
      expect(screen.getByText('Resumen semanal')).toBeInTheDocument(),
    );

    expect(
      screen.getByText(/lo que businessbrain ha comprendido/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/lo que encuentre sobre «devoluciones»/i)).toBeInTheDocument();
    // "2 sección(es) · PDF" no le dice nada a nadie sobre lo que va a leer.
    expect(screen.queryByText(/secci[oó]n\(es\)/i)).toBeNull();
  });

  it('el aviso de alcance se dice una vez, no en cada informe', async () => {
    respuestas = {
      '/reports': [
        informe([{ type: 'INSIGHTS', title: 'A', limit: 5 }]),
        { ...informe([{ type: 'INSIGHTS', title: 'B', limit: 5 }]), id: 'r2' },
      ],
    };
    renderLocalized(<ReportsPage />);

    await waitFor(() =>
      expect(screen.getAllByText(/resumen semanal/i).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/tu alcance|lo que tú tienes/i)).toHaveLength(1);
  });
});
