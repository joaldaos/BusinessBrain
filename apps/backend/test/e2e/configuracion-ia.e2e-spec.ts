import { MembershipRole } from '@businessbrain/database';
import { ProviderRegistry } from '../../src/llm/application/provider-registry.service';
import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  startTestApp,
  stopTestApp,
  type TestActor,
  type TestTenant,
} from './harness';

/**
 * Configurar la IA por HTTP, atravesando la aplicación real.
 *
 * Es el primer paso de una empresa nueva y hasta ahora solo se podía dar escribiendo en la base
 * de datos. Esta suite comprueba lo que importa de una superficie que recibe un secreto: quién
 * puede tocarla, que el secreto no vuelve a salir por ninguna vía, y que una clave que no
 * funciona no se guarda.
 */
describe('Configuración de IA (E2E)', () => {
  let tenant: TestTenant;
  const extraUsers: string[] = [];
  const embed = jest.fn();

  beforeAll(async () => {
    // Se sustituye SOLO la llamada al proveedor externo: todo lo demás —guards, validación,
    // cifrado, persistencia, auditoría— es la aplicación tal como se despliega.
    await startTestApp([
      {
        token: ProviderRegistry,
        value: {
          getEmbeddingProvider: () => ({ embed }),
          resolveForOrganization: () =>
            Promise.resolve({ profile: {}, provider: {}, apiKey: undefined }),
        },
      },
    ]);
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    embed.mockReset();
    embed.mockResolvedValue([new Array(1536).fill(0.05)]);
    tenant = await createTenant('ia');
  });

  afterEach(async () => {
    await prisma.llmProfile.deleteMany({ where: { organizationId: null } });
    await destroyTenant(tenant, extraUsers.splice(0));
  });

  const configure = (actor: TestActor, apiKey = 'sk-clave-de-la-empresa') =>
    as(actor, tenant)
      .post('/ai-configuration')
      .send({ provider: 'OPENAI', apiKey });

  it('CRITERIO DE CIERRE: una empresa nueva deja la IA lista desde la interfaz', async () => {
    // Parte de cero: recién creada, no está lista y se dice por qué.
    const antes = await as(tenant.owner, tenant)
      .get('/ai-configuration')
      .expect(200);
    expect(antes.body.data).toMatchObject({
      ready: false,
      origin: 'SIN_CONFIGURAR',
    });
    expect(antes.body.data.explanation).toMatch(
      /no puede leer tus documentos/i,
    );

    // El catálogo dice qué elegir y dónde conseguir la clave.
    const providers = await as(tenant.owner, tenant)
      .get('/ai-configuration/providers')
      .expect(200);
    expect(providers.body.data[0]).toMatchObject({ provider: 'OPENAI' });
    expect(providers.body.data[0].helpUrl).toMatch(/^https:\/\//);

    const configured = await configure(tenant.owner).expect(201);

    expect(configured.body.data).toMatchObject({
      ready: true,
      origin: 'PROPIA',
      hasOwnKey: true,
    });
    // Se comprobó contra el proveedor ANTES de guardar.
    expect(embed).toHaveBeenCalledTimes(1);
  });

  describe('CRÍTICO: la clave no sale por ninguna vía', () => {
    it('ni al guardarla, ni al leer el estado', async () => {
      const guardado = await configure(tenant.owner).expect(201);
      expect(JSON.stringify(guardado.body)).not.toContain(
        'sk-clave-de-la-empresa',
      );

      const estado = await as(tenant.owner, tenant)
        .get('/ai-configuration')
        .expect(200);
      // Ni entera ni enmascarada: lo único que se dice es que existe.
      expect(JSON.stringify(estado.body)).not.toContain('sk-');
      expect(estado.body.data.hasOwnKey).toBe(true);
    });

    it('y en la base de datos está cifrada', async () => {
      await configure(tenant.owner).expect(201);

      const stored = await prisma.llmProfile.findFirstOrThrow({
        where: { organizationId: tenant.organizationId },
      });
      expect(stored.apiKeyEnc).not.toContain('sk-clave-de-la-empresa');
    });
  });

  describe('CRÍTICO: se comprueba antes de guardar', () => {
    it('una clave rechazada NO se guarda y se explica sin tecnicismos', async () => {
      embed.mockRejectedValue(
        new Error(
          '401 {"error":{"message":"Incorrect API key provided: sk-abc"}}',
        ),
      );

      const respuesta = await configure(
        tenant.owner,
        'sk-una-clave-que-no-vale',
      ).expect(400);

      const mensaje = JSON.stringify(respuesta.body);
      expect(mensaje).toMatch(/copiado entera/i);
      // Ni el cuerpo del proveedor, ni códigos, ni fragmentos de la clave ajena.
      expect(mensaje).not.toMatch(/401|Incorrect API key|sk-abc/);

      expect(
        await prisma.llmProfile.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(0);
    });

    it('sin saldo en la cuenta del proveedor se dice qué revisar', async () => {
      embed.mockRejectedValue(new Error('429 quota exceeded'));

      const respuesta = await configure(tenant.owner).expect(400);
      expect(JSON.stringify(respuesta.body)).toMatch(/saldo o el límite/i);
    });

    it('un proveedor fuera del catálogo se rechaza sin llamar a nadie', async () => {
      await as(tenant.owner, tenant)
        .post('/ai-configuration')
        .send({ provider: 'GEMINI', apiKey: 'x'.repeat(20) })
        .expect(400);

      expect(embed).not.toHaveBeenCalled();
    });

    it('una clave demasiado corta ni llega al proveedor, y se dice en castellano', async () => {
      const respuesta = await as(tenant.owner, tenant)
        .post('/ai-configuration')
        .send({ provider: 'OPENAI', apiKey: 'sk-1' })
        .expect(400);

      // El mensaje por defecto de la validación nombra el campo y va en inglés.
      expect(JSON.stringify(respuesta.body)).toMatch(/demasiado corta/i);
      expect(JSON.stringify(respuesta.body)).not.toMatch(/apiKey|characters/);
      expect(embed).not.toHaveBeenCalled();
    });
  });

  describe('quién puede tocarlo', () => {
    it('un MEMBER lo VE pero no lo cambia', async () => {
      const colega: TestActor = await addMember(
        tenant,
        MembershipRole.MEMBER,
        'colega',
      );
      extraUsers.push(colega.userId);

      // Verlo sí: explica por qué una pregunta suya no encuentra nada.
      await as(colega, tenant).get('/ai-configuration').expect(200);
      // Cambiarlo no: compromete gasto real en la cuenta de la empresa.
      await as(colega, tenant)
        .post('/ai-configuration')
        .send({ provider: 'OPENAI', apiKey: 'sk-la-suya' })
        .expect(403);
      await as(colega, tenant).delete('/ai-configuration').expect(403);
    });

    it('sin sesión no se llega', async () => {
      await http().get('/ai-configuration').expect(401);
      await http()
        .post('/ai-configuration')
        .send({ provider: 'OPENAI', apiKey: 'sk-cualquiera' })
        .expect(401);
    });

    it('CRÍTICO: otra empresa no ve ni hereda esta configuración', async () => {
      await configure(tenant.owner).expect(201);
      const rival = await createTenant('ia-rival');

      const suyo = await as(rival.owner, rival)
        .get('/ai-configuration')
        .expect(200);

      expect(suyo.body.data).toMatchObject({
        ready: false,
        hasOwnKey: false,
        origin: 'SIN_CONFIGURAR',
      });

      await destroyTenant(rival);
    });
  });

  it('quitar la clave deja de declarar la IA como propia', async () => {
    await configure(tenant.owner).expect(201);

    const tras = await as(tenant.owner, tenant)
      .delete('/ai-configuration')
      .expect(200);

    expect(tras.body.data.hasOwnKey).toBe(false);
    expect(
      await prisma.llmProfile.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(0);
  });

  it('ninguna respuesta de esta superficie menciona detalles técnicos', async () => {
    // Requisito de producto: una PYME nunca debe leer nombres de columnas, clases ni
    // variables de entorno.
    embed.mockRejectedValue(new Error('fetch failed'));
    const respuestas = [
      await as(tenant.owner, tenant).get('/ai-configuration').expect(200),
      await configure(tenant.owner).expect(400),
    ];

    for (const respuesta of respuestas) {
      expect(JSON.stringify(respuesta.body)).not.toMatch(
        /LlmProfile|apiKeyEnc|OPENAI_API_KEY|ENCRYPTION_KEY|Exception|Service|undefined/,
      );
    }
  });
});
