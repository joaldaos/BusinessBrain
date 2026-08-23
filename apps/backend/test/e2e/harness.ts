import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, type MembershipRole } from '@businessbrain/database';
import { AppModule } from '../../src/app.module';
import { configureApp, type AppSurfaceOptions } from '../../src/bootstrap';
import { ProviderRegistry } from '../../src/llm/application/provider-registry.service';

/**
 * Arranque REAL de la aplicación para los tests de extremo a extremo — subfase 5.9.
 *
 * Hasta aquí el proyecto no tenía ni un solo test HTTP: toda la integración instanciaba
 * servicios directamente, así que `JwtAuthGuard`, `OrgRoleGuard` y `@OrgRoles` eran código
 * correcto **que nadie había ejecutado nunca**. Un servicio puede estar perfectamente
 * aislado y quedar expuesto igualmente si la ruta que lo publica no lleva el guard que le
 * corresponde, y eso no se ve desde una llamada directa.
 *
 * Aquí se levanta el `AppModule` COMPLETO —los mismos pipes, filtros e interceptores que
 * `main.ts`— contra el Postgres real. Lo único que se sustituye es el proveedor de LLM,
 * porque una llamada real sigue pendiente de credenciales; todo lo demás es producción.
 */

/**
 * Los límites de peticiones se relajan MUCHO para las suites, no se apagan.
 *
 * Cada suite registra decenas de usuarios desde la misma dirección (127.0.0.1) y con los
 * números de producción se cortaría a sí misma a los cinco registros. Subir el multiplicador
 * en vez de desactivar el guard es deliberado: el mecanismo sigue montado y enchufado en todas
 * las rutas, que es lo que hay que verificar aquí. Los números de verdad los comprueba
 * `limites-peticiones.e2e-spec.ts`, que los baja a propósito.
 */
process.env.RATE_LIMIT_MULTIPLIER ??= '1000';

export const prisma = new PrismaClient();

/** Respuestas del modelo que devolverá el doble, en orden. Se reinicia en cada test. */
export const llmScript: { answers: string[] } = { answers: [] };

let app: INestApplication;
/** Perfil de plataforma sembrado por esta suite, para retirarlo al terminar. */
let seededProfileId: string | null = null;

export function http() {
  return request(app.getHttpServer());
}

/**
 * Sustitución adicional de un proveedor concreto.
 *
 * Existe únicamente para las suites que necesitan un RAZONAMIENTO determinista —no un
 * modelo— y que aun así quieren atravesar la aplicación real: guards, controladores,
 * persistencia y transacciones. Toda suite que la use debe decir en el propio test QUÉ
 * sustituye y por qué, para que nunca se confunda con producción.
 */
export interface ProviderOverride {
  token: unknown;
  value: unknown;
}

export async function startTestApp(
  overrides: ProviderOverride[] = [],
  /**
   * Cómo se envuelve la aplicación. Por defecto, lo mismo que un desarrollo local.
   *
   * La suite de origen cruzado lo levanta como PRODUCCIÓN, que es el único modo donde la
   * política es estricta y por tanto el único donde tiene sentido comprobarla.
   */
  surface: AppSurfaceOptions = {
    isProduction: false,
    frontendUrl: 'http://localhost:5173',
  },
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    // Sustitución por defecto. El proveedor real no puede llamarse sin credenciales, y esta
    // suite existe para verificar guards, aislamiento y autorización, no la calidad del
    // modelo.
    .overrideProvider(ProviderRegistry)
    .useValue(fakeProviderRegistry());

  for (const override of overrides) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }

  const moduleRef = await builder.compile();

  app = moduleRef.createNestApplication();

  // La MISMA función que `main.ts`, no una copia. Mientras fueron dos listas paralelas, la
  // política de origen cruzado existía en producción y no aquí: se podía cerrar mal sin que
  // ninguna prueba se enterara.
  configureApp(app, surface);

  await app.init();

  // El Retriever vectoriza la consulta y para eso resuelve un `LlmProfile` por defecto. En
  // producción siempre existe uno de plataforma; sin él, cualquier turno responde 500. Se
  // siembra solo si falta, para no pisar la configuración de un entorno que ya la tenga.
  const existing = await prisma.llmProfile.findFirst({
    where: { organizationId: null, isDefault: true },
  });
  if (!existing) {
    const created = await prisma.llmProfile.create({
      data: {
        organizationId: null,
        provider: 'OPENAI',
        modelName: 'test-model',
        isDefault: true,
      },
    });
    seededProfileId = created.id;
  }

  return app;
}

export async function stopTestApp(): Promise<void> {
  if (seededProfileId) {
    await prisma.llmProfile.deleteMany({ where: { id: seededProfileId } });
    seededProfileId = null;
  }
  await app?.close();
  await prisma.$disconnect();
}

function fakeProviderRegistry() {
  const nextAnswer = (): string =>
    llmScript.answers.shift() ?? 'Respuesta de prueba.';

  const provider = {
    name: 'OPENAI',
    complete: () => Promise.resolve({ content: nextAnswer(), model: 'test' }),
    stream: async function* () {
      yield await Promise.resolve(nextAnswer());
    },
  };
  const resolved = {
    profile: { modelName: 'test-model', apiKeyEnc: null },
    provider,
  };

  const embeddings = {
    embed: (texts: string[]) =>
      Promise.resolve(texts.map(() => new Array(1536).fill(0))),
  };

  return {
    resolveForOrganization: () => Promise.resolve(resolved),
    resolveForAgent: () => Promise.resolve(resolved),
    getLlmProvider: () => provider,
    getEmbeddingProvider: () => embeddings,
    // Mismo contrato que el registro real: resuelve proveedor de embeddings Y clave ya
    // DESCIFRADA. El doble tiene que respetarlo, o el camino de recuperación no se ejercita.
    resolveEmbeddingsForOrganization: () =>
      Promise.resolve({
        provider: embeddings,
        modelName: 'text-embedding-3-small',
        apiKey: undefined,
      }),
  };
}

export interface TestActor {
  userId: string;
  email: string;
  accessToken: string;
}

export interface TestTenant {
  organizationId: string;
  owner: TestActor;
}

let seq = 0;
const unique = () =>
  `${Date.now()}${(seq += 1)}${Math.random().toString(36).slice(2, 6)}`;

/** Registra un usuario y devuelve su token, atravesando el flujo HTTP real de auth. */
export async function registerActor(prefix: string): Promise<TestActor> {
  const email = `${prefix}-${unique()}@e2e.local`;
  const password = 'contrasena-de-prueba';

  const registered = await http()
    .post('/auth/register')
    .send({ email, password, name: prefix })
    .expect(201);

  const login = await http()
    .post('/auth/login')
    .send({ email, password })
    .expect(201);

  return {
    userId: registered.body.data.user?.id ?? login.body.data.user.id,
    email,
    accessToken: login.body.data.accessToken,
  };
}

/** Crea una organización por HTTP; quien la crea queda como OWNER. */
export async function createTenant(prefix: string): Promise<TestTenant> {
  const owner = await registerActor(prefix);

  const response = await http()
    .post('/organizations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ name: `${prefix}-${unique()}` })
    .expect(201);

  return { organizationId: response.body.data.id, owner };
}

/**
 * Añade a alguien a la organización con un rol concreto.
 *
 * La membresía se crea directamente en la base de datos porque el flujo de invitación tiene
 * su propia superficie y no es lo que esta suite verifica. El TOKEN, en cambio, es real: se
 * obtiene por login, de modo que todo lo que se prueba después atraviesa el guard de verdad.
 */
export async function addMember(
  tenant: TestTenant,
  role: MembershipRole,
  prefix = 'member',
): Promise<TestActor> {
  const actor = await registerActor(prefix);
  await prisma.membership.create({
    data: {
      userId: actor.userId,
      organizationId: tenant.organizationId,
      role,
    },
  });

  // El token se reemite DESPUÉS de crear la membresía: `JwtStrategy` resuelve las
  // pertenencias al validar, y un token anterior no las llevaría.
  const login = await http()
    .post('/auth/login')
    .send({ email: actor.email, password: 'contrasena-de-prueba' })
    .expect(201);

  return { ...actor, accessToken: login.body.data.accessToken };
}

/** Petición autenticada y con organización activa: como la haría un cliente real. */
export function as(actor: TestActor, tenant?: TestTenant) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${actor.accessToken}`,
  };
  if (tenant) headers['x-org-id'] = tenant.organizationId;

  return {
    get: (url: string) => http().get(url).set(headers),
    post: (url: string) => http().post(url).set(headers),
    patch: (url: string) => http().patch(url).set(headers),
    delete: (url: string) => http().delete(url).set(headers),
  };
}

/**
 * Siembra comprensión REAL acotada a una colección.
 *
 * Un agente sin conocimiento ni comprensión no llama al modelo: responde "no lo sé" y el
 * turno termina antes del bucle. Para poder verificar el camino completo hace falta que
 * `RetrieveInsights` devuelva algo dentro del alcance del agente, y eso exige evidencia real
 * perteneciente a esa colección — que es justo lo que hace de esto una prueba de verdad y no
 * un atajo: si el alcance estuviera mal aplicado, esta siembra no aparecería.
 */
export async function seedUnderstanding(
  tenant: TestTenant,
  collectionId: string,
): Promise<{ insightId: string }> {
  const source = await prisma.knowledgeSource.create({
    data: {
      organizationId: tenant.organizationId,
      type: 'FILE_UPLOAD',
      name: 'Fuente E2E',
      connectorKey: 'file_upload_v1',
      createdById: tenant.owner.userId,
      status: 'CONNECTED',
      configEnc: '',
    },
  });
  const run = await prisma.analysisRun.create({
    data: {
      organizationId: tenant.organizationId,
      trigger: 'MANUAL',
      status: 'SUCCESS',
    },
  });
  const item = await prisma.knowledgeItem.create({
    data: {
      organizationId: tenant.organizationId,
      originKnowledgeSourceId: source.id,
      currentKnowledgeSourceId: source.id,
      title: 'Política de descuentos',
      contentText:
        'Los descuentos aplicados superan el margen objetivo. '.repeat(5),
      contentHash: `hash-${unique()}`,
      status: 'INDEXED',
      indexedAt: new Date(),
      businessArea: 'SALES',
      confidenceScore: 0.9,
      confidenceComputedAt: new Date(),
    },
  });
  await prisma.knowledgeItemCollection.create({
    data: {
      organizationId: tenant.organizationId,
      knowledgeItemId: item.id,
      knowledgeCollectionId: collectionId,
    },
  });

  const insight = await prisma.insight.create({
    data: {
      organizationId: tenant.organizationId,
      analysisRunId: run.id,
      subjectIdentity: `descuentos-${unique()}`,
      type: 'ANOMALY',
      summary: 'Los descuentos aplicados superan el margen objetivo.',
      status: 'ACTIVE',
      strategyKey: 'e2e',
      strategyVersion: '1.0.0',
      reasoningTrace: { rule: 'e2e' },
      confidence: 0.9,
      confidenceComputedAt: new Date(),
      transitiveEvidenceClosure: [{ kind: 'KNOWLEDGE_ITEM', refId: item.id }],
    },
  });
  await prisma.insightEvidence.create({
    data: {
      insightId: insight.id,
      kind: 'KNOWLEDGE_ITEM',
      role: 'BASELINE',
      knowledgeItemId: item.id,
    },
  });

  return { insightId: insight.id };
}

/** Limpia una organización y sus usuarios. La cascada arrastra el resto. */
export async function destroyTenant(
  tenant: TestTenant,
  extraUserIds: string[] = [],
): Promise<void> {
  await prisma.organization.deleteMany({
    where: { id: tenant.organizationId },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [tenant.owner.userId, ...extraUserIds] } },
  });
}
