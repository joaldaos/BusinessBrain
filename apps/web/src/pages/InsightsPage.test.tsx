import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CurationBadge, FreshnessBadge } from './InsightsPage';
import type { Insight } from '../api/types';

const insight = (overrides: Partial<Insight> = {}): Insight => ({
  id: 'i1',
  type: 'ANOMALY',
  summary: 'Los descuentos superan el margen objetivo',
  status: 'ACTIVE',
  confidence: 0.9,
  freshness: 'FRESH',
  freshnessRationale: '',
  strategyKey: 'knowledge-signal',
  evidence: [],
  businessObjectives: [],
  curation: null,
  createdAt: '2026-08-16T10:00:00.000Z',
  ...overrides,
});

/**
 * Dos condiciones que el backend calcula con cuidado y que la interfaz NO puede aplanar:
 * la frescura de la evidencia y el origen de la curación. Presentarlas igual convertiría en
 * invisible justo lo que el motor se esfuerza en declarar.
 */
describe('cómo se presenta una conclusión', () => {
  it('una validación HEREDADA no se presenta como propia', () => {
    // Heredada significa que la persona validó una versión ANTERIOR de la creencia.
    render(
      <CurationBadge
        insight={insight({
          curation: {
            type: 'CONFIRMATION',
            comment: null,
            at: '2026-08-01T00:00:00.000Z',
            origin: 'INHERITED',
            curatedVersionId: 'v0',
            disputed: false,
          },
        })}
      />,
    );

    expect(screen.getByText(/versión anterior/i)).toBeInTheDocument();
    expect(screen.queryByText('validado por una persona')).toBeNull();
  });

  it('una validación en disputa se marca como tal', () => {
    render(
      <CurationBadge
        insight={insight({
          curation: {
            type: 'CONFIRMATION',
            comment: null,
            at: '2026-08-01T00:00:00.000Z',
            origin: 'INHERITED',
            curatedVersionId: 'v0',
            disputed: true,
          },
        })}
      />,
    );

    expect(screen.getByText(/en disputa/i)).toBeInTheDocument();
  });

  it('una validación propia se presenta como tal', () => {
    render(
      <CurationBadge
        insight={insight({
          curation: {
            type: 'CONFIRMATION',
            comment: null,
            at: '2026-08-16T00:00:00.000Z',
            origin: 'OWN',
            curatedVersionId: 'i1',
            disputed: false,
          },
        })}
      />,
    );

    expect(screen.getByText('validado por una persona')).toBeInTheDocument();
  });

  it('sin curación no se inventa ninguna insignia', () => {
    const { container } = render(<CurationBadge insight={insight()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('una conclusión cuya evidencia cambió NO se presenta como vigente', () => {
    // §3.4: "la frescura se entrega, no se oculta".
    render(<FreshnessBadge insight={insight({ freshness: 'STALE' })} />);
    expect(screen.getByText(/su evidencia cambió/i)).toBeInTheDocument();
  });

  it('la evidencia intacta se distingue de la irresoluble', () => {
    const { rerender } = render(<FreshnessBadge insight={insight()} />);
    expect(screen.getByText(/intacta/i)).toBeInTheDocument();

    rerender(
      <FreshnessBadge insight={insight({ freshness: 'UNRESOLVABLE' })} />,
    );
    expect(screen.getByText(/irresoluble/i)).toBeInTheDocument();
  });
});
