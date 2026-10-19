import { BusinessEventKind } from '@businessbrain/database';
import { BusinessConnectorRegistry } from './business-connector-registry.service';
import {
  canComputeMetric,
  declaresEvent,
  type BusinessConnectorPort,
  type ConnectorCapabilities,
} from '../domain/ports/business-connector.port';

/**
 * El registro de conectores y las capacidades que declaran.
 *
 * Las capacidades no son documentación: son lo que impide prometer una métrica que no se
 * puede calcular. Si un TPV no entrega la hora de «plato listo», la pantalla de tiempos de
 * cocina no existe — y se dice antes de conectar, no después.
 */
describe('BusinessConnectorRegistry', () => {
  const conector = (
    key: string,
    capabilities?: Partial<ConnectorCapabilities>,
  ): BusinessConnectorPort => ({
    key,
    displayName: key,
    identity: { authKind: 'API_KEY', scopesDescription: [] },
    capabilities: {
      entities: [],
      events: [],
      delivery: 'POLL',
      backfill: false,
      ...capabilities,
    },
    describeScope: () => null,
    pull: jest.fn(),
    health: jest.fn(),
  });

  it('encuentra un conector por su clave', () => {
    const registro = new BusinessConnectorRegistry([conector('square_v1')]);

    expect(registro.get('square_v1').key).toBe('square_v1');
    expect(registro.keys()).toEqual(['square_v1']);
  });

  /**
   * La clave decide qué implementación atiende a una empresa. Si hubiera dos, cuál ganara
   * dependería del orden de los módulos y los datos acabarían entrando por el sitio
   * equivocado — en silencio.
   */
  it('rechaza al arrancar dos conectores con la misma clave', () => {
    expect(
      () =>
        new BusinessConnectorRegistry([
          conector('duplicado'),
          conector('duplicado'),
        ]),
    ).toThrow(/dos conectores/i);
  });

  it('devuelve null —y no revienta— al buscar uno que ya no existe', () => {
    // Pasa de verdad: una fila antigua apunta a un conector retirado, y la pantalla tiene
    // que poder contarlo en vez de caerse.
    expect(new BusinessConnectorRegistry([]).find('retirado')).toBeNull();
  });

  it('lanza con la lista de disponibles cuando no tenerlo es un fallo de programación', () => {
    const registro = new BusinessConnectorRegistry([conector('square_v1')]);

    expect(() => registro.get('no-existe')).toThrow(/square_v1/);
  });

  it('arranca sin ningún conector declarado', () => {
    expect(new BusinessConnectorRegistry(null).keys()).toEqual([]);
  });
});

describe('capacidades declaradas', () => {
  const capacidades = (events: BusinessEventKind[]): ConnectorCapabilities => ({
    entities: [],
    events,
    delivery: 'POLL',
    backfill: false,
  });

  it('un hecho no declarado no se produce jamás', () => {
    const tpvSimple = capacidades([BusinessEventKind.SALE_RECORDED]);

    expect(declaresEvent(tpvSimple, BusinessEventKind.SALE_RECORDED)).toBe(
      true,
    );
    expect(declaresEvent(tpvSimple, BusinessEventKind.ORDER_ITEM_READY)).toBe(
      false,
    );
  });

  /**
   * Todos, no algunos: un tiempo de preparación con la hora de entrada pero sin la de
   * salida no es una media peor — es una media imposible.
   */
  it('una métrica exige TODOS sus hechos, no algunos', () => {
    const tiempoDeCocina = [
      BusinessEventKind.ORDER_SENT_TO_KITCHEN,
      BusinessEventKind.ORDER_ITEM_READY,
    ];

    const completo = capacidades(tiempoDeCocina);
    const aMedias = capacidades([BusinessEventKind.ORDER_SENT_TO_KITCHEN]);

    expect(canComputeMetric(completo, tiempoDeCocina)).toBe(true);
    expect(canComputeMetric(aMedias, tiempoDeCocina)).toBe(false);
  });

  it('una métrica sin requisitos se puede calcular siempre', () => {
    expect(canComputeMetric(capacidades([]), [])).toBe(true);
  });

  /**
   * El caso real del informe: un TPV que solo da apertura y cierre permite medir el
   * servicio total, pero NO los tiempos de cocina.
   */
  it('distingue qué se puede prometer a una empresa y qué no', () => {
    const soloAperturaYCierre = capacidades([
      BusinessEventKind.ORDER_PLACED,
      BusinessEventKind.ORDER_COMPLETED,
    ]);

    expect(
      canComputeMetric(soloAperturaYCierre, [
        BusinessEventKind.ORDER_PLACED,
        BusinessEventKind.ORDER_COMPLETED,
      ]),
    ).toBe(true);

    expect(
      canComputeMetric(soloAperturaYCierre, [
        BusinessEventKind.ORDER_SENT_TO_KITCHEN,
        BusinessEventKind.ORDER_ITEM_READY,
      ]),
    ).toBe(false);
  });
});
