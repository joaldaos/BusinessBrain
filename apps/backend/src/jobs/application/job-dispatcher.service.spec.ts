import { Logger } from '@nestjs/common';
import { JobDispatcherService } from './job-dispatcher.service';
import { JobHandlerRegistry } from './job-handler-registry';
import type { JobHandler } from '../domain/ports/job-queue.port';
import type { ClaimedJob } from '../infrastructure/postgres-job-queue';

/**
 * El tic que vacía la cola.
 *
 * Lo que se comprueba aquí no es que funcione el camino feliz —eso lo cubre la prueba de
 * integración con la base delante— sino las cuatro garantías de las que depende que las
 * integraciones sean fiables: que un fallo no arrastre al resto, que nada se reintente
 * eternamente, que lo inatendible muera en el acto y que un fallo al anotar el fallo no
 * tumbe el tic entero.
 */
describe('JobDispatcherService', () => {
  const trabajo = (parcial: Partial<ClaimedJob> = {}): ClaimedJob => ({
    id: 'job-1',
    kind: 'prueba',
    organizationId: 'org-1',
    payload: {},
    attempts: 1,
    maxAttempts: 5,
    ...parcial,
  });

  /** Doble de la cola que registra qué se le pidió. */
  const colaFalsa = (reclamados: ClaimedJob[]) => ({
    claim: jest.fn().mockResolvedValue(reclamados),
    succeed: jest.fn().mockResolvedValue(undefined),
    reschedule: jest.fn().mockResolvedValue(undefined),
    bury: jest.fn().mockResolvedValue(undefined),
    enqueue: jest.fn(),
  });

  const registroCon = (...handlers: JobHandler[]) =>
    new JobHandlerRegistry(handlers);

  const despachador = (
    cola: ReturnType<typeof colaFalsa>,
    registro: JobHandlerRegistry,
  ) => new JobDispatcherService(cola as never, registro);

  beforeAll(() => {
    // El tic registra avisos y errores a propósito. En las pruebas solo son ruido.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  it('ejecuta un trabajo y lo da por cumplido', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const cola = colaFalsa([trabajo()]);

    await despachador(cola, registroCon({ kind: 'prueba', handle })).drain();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(cola.succeed).toHaveBeenCalledWith('job-1');
    expect(cola.reschedule).not.toHaveBeenCalled();
  });

  it('entrega al manejador solo lo que le incumbe', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const cola = colaFalsa([
      trabajo({ payload: { fuente: 'tpv' }, attempts: 2 }),
    ]);

    await despachador(cola, registroCon({ kind: 'prueba', handle })).drain();

    expect(handle).toHaveBeenCalledWith({
      id: 'job-1',
      kind: 'prueba',
      organizationId: 'org-1',
      payload: { fuente: 'tpv' },
      attempts: 2,
      maxAttempts: 5,
    });
  });

  /**
   * La garantía que más importa: una empresa con un conector roto no puede dejar sin
   * servicio a las demás.
   */
  it('un trabajo que falla NO impide que se ejecuten los demás', async () => {
    const bueno = jest.fn().mockResolvedValue(undefined);
    const cola = colaFalsa([
      trabajo({ id: 'malo', kind: 'rompe' }),
      trabajo({ id: 'bueno', kind: 'va' }),
    ]);

    await despachador(
      cola,
      registroCon(
        {
          kind: 'rompe',
          handle: jest.fn().mockRejectedValue(new Error('boom')),
        },
        { kind: 'va', handle: bueno },
      ),
    ).drain();

    expect(bueno).toHaveBeenCalledTimes(1);
    expect(cola.succeed).toHaveBeenCalledWith('bueno');
    expect(cola.reschedule).toHaveBeenCalledWith(
      'malo',
      expect.any(Date),
      'boom',
    );
  });

  it('reprograma hacia el futuro cuando quedan intentos', async () => {
    const ahora = new Date('2026-10-19T10:00:00.000Z');
    const cola = colaFalsa([trabajo({ attempts: 1 })]);

    await despachador(
      cola,
      registroCon({
        kind: 'prueba',
        handle: jest
          .fn()
          .mockRejectedValue(new Error('el proveedor no responde')),
      }),
    ).drain(ahora);

    const [, runAt] = cola.reschedule.mock.calls[0] as [string, Date, string];
    expect(runAt.getTime()).toBeGreaterThan(ahora.getTime());
    expect(cola.bury).not.toHaveBeenCalled();
  });

  it('entierra el trabajo al agotar los intentos, con su último error', async () => {
    const cola = colaFalsa([trabajo({ attempts: 5, maxAttempts: 5 })]);

    await despachador(
      cola,
      registroCon({
        kind: 'prueba',
        handle: jest.fn().mockRejectedValue(new Error('sigue sin responder')),
      }),
    ).drain();

    expect(cola.bury).toHaveBeenCalledWith('job-1', 'sigue sin responder');
    expect(cola.reschedule).not.toHaveBeenCalled();
  });

  /**
   * Fallo cerrado. Reintentarlo cinco veces no haría aparecer el manejador, y mientras
   * tanto ocuparía un turno en cada tic.
   */
  it('entierra EN EL ACTO un trabajo que nadie sabe atender', async () => {
    const cola = colaFalsa([trabajo({ kind: 'nadie-sabe' })]);

    await despachador(
      cola,
      registroCon({ kind: 'otro', handle: jest.fn() }),
    ).drain();

    expect(cola.bury).toHaveBeenCalledTimes(1);
    expect(cola.bury.mock.calls[0]?.[1]).toMatch(/no hay manejador/i);
    expect(cola.reschedule).not.toHaveBeenCalled();
  });

  /**
   * Si la base falla al anotar el fallo, el trabajo queda en RUNNING y lo recupera el
   * arrendamiento. Lo que no puede pasar es que el tic entero se caiga.
   */
  it('sobrevive a un fallo al registrar el fallo', async () => {
    const cola = colaFalsa([trabajo({ id: 'a' }), trabajo({ id: 'b' })]);
    cola.reschedule.mockRejectedValueOnce(new Error('la base no responde'));
    const handle = jest
      .fn()
      .mockRejectedValueOnce(new Error('primero'))
      .mockResolvedValueOnce(undefined);

    const ejecutados = await despachador(
      cola,
      registroCon({ kind: 'prueba', handle }),
    ).drain();

    expect(ejecutados).toEqual(['a', 'b']);
    expect(cola.succeed).toHaveBeenCalledWith('b');
  });

  it('no reclama más de lo que puede atender en un tic', async () => {
    const cola = colaFalsa([]);

    await despachador(cola, registroCon()).drain();

    const [, limite] = cola.claim.mock.calls[0] as [string, number, Date];
    expect(limite).toBeGreaterThan(0);
    expect(limite).toBeLessThanOrEqual(100);
  });
});

describe('JobHandlerRegistry', () => {
  it('rechaza dos manejadores para la misma clase de trabajo', () => {
    expect(
      () =>
        new JobHandlerRegistry([
          { kind: 'duplicado', handle: jest.fn() },
          { kind: 'duplicado', handle: jest.fn() },
        ]),
    ).toThrow(/dos manejadores/i);
  });

  it('acepta no tener ninguno, y entonces no conoce ninguna clase', () => {
    const registro = new JobHandlerRegistry(null);
    expect(registro.kinds()).toEqual([]);
    expect(registro.get('lo-que-sea')).toBeNull();
  });

  it('admite un único manejador suelto, no solo un array', () => {
    const registro = new JobHandlerRegistry({
      kind: 'solo',
      handle: jest.fn(),
    });
    expect(registro.get('solo')).not.toBeNull();
  });
});
