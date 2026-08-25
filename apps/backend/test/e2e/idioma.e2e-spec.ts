import {
  addMember,
  as,
  createTenant,
  destroyTenant,
  http,
  prisma,
  startTestApp,
  stopTestApp,
  type TestTenant,
} from './harness';

/**
 * El idioma de cada persona (E2E).
 *
 * ## Por qué cuelga de la PERSONA y no de la empresa
 *
 * Dos personas de la misma empresa pueden quererlo distinto, y no es un caso raro: una
 * gestoría con un cliente francés, o una empresa con alguien de fuera en el equipo. Si el
 * idioma colgara de la organización, elegirlo se lo cambiaría a todo el mundo.
 *
 * Eso lo convierte además en una superficie de aislamiento más: cambiar el mío no puede tocar
 * el de nadie.
 */
describe('Idioma de la interfaz (E2E)', () => {
  let tenant: TestTenant;
  let companero: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    await startTestApp();
    tenant = await createTenant('idioma');
    companero = await addMember(tenant, 'MEMBER', 'idioma-companero');
  });

  afterAll(async () => {
    await destroyTenant(tenant, [companero.userId]);
    await stopTestApp();
  });

  const yo = () => as(tenant.owner, tenant);
  const localeDe = (respuesta: { body: unknown }) =>
    (respuesta.body as { data: { locale: string } }).data.locale;

  it('quien no ha elegido recibe un idioma resuelto, nunca vacío', async () => {
    // Si llegara nulo, cada pantalla tendría que decidir qué hacer con él y alguna acabaría
    // cayendo a un idioma distinto del resto.
    const respuesta = await yo().get('/auth/me').expect(200);

    expect(localeDe(respuesta)).toBe('es');
  });

  it('CRÍTICO: la elección se guarda y vuelve en la sesión', async () => {
    await yo().patch('/auth/me/language').send({ locale: 'en' }).expect(200);

    // No basta con que responda bien: tiene que seguir ahí en la siguiente sesión, que es lo
    // que hace que no haya que elegirlo en cada visita.
    const respuesta = await yo().get('/auth/me').expect(200);
    expect(localeDe(respuesta)).toBe('en');
  });

  it('se puede volver al castellano', async () => {
    await yo().patch('/auth/me/language').send({ locale: 'es' }).expect(200);

    await expect(yo().get('/auth/me').expect(200).then(localeDe)).resolves.toBe(
      'es',
    );
  });

  it('CRÍTICO: un idioma que todavía no hablamos se rechaza', async () => {
    // Guardar `fr` sin traducciones dejaría la interfaz medio en un idioma y medio en otro,
    // que es peor que no ofrecerlo.
    const respuesta = await yo()
      .patch('/auth/me/language')
      .send({ locale: 'fr' })
      .expect(400);

    const cuerpo = JSON.stringify(respuesta.body);
    expect(cuerpo).toMatch(/idioma/i);
    // Y el mensaje se entiende: nada de nombres de clase ni de constantes.
    expect(cuerpo).not.toMatch(/ValidationPipe|isIn|Locale|enum/i);
  });

  it('un idioma inventado tampoco cuela', async () => {
    for (const basura of ['', 'es-ES', 'ESPAÑOL', 'xx']) {
      await yo()
        .patch('/auth/me/language')
        .send({ locale: basura })
        .expect(400);
    }
  });

  it('CRÍTICO: cambiar el mío no toca el de nadie más', async () => {
    await yo().patch('/auth/me/language').send({ locale: 'en' }).expect(200);

    const suyo = await as(companero, tenant).get('/auth/me').expect(200);
    expect(localeDe(suyo)).toBe('es');

    // Y al revés: el compañero cambia el suyo y el mío se queda como estaba.
    await as(companero, tenant)
      .patch('/auth/me/language')
      .send({ locale: 'en' })
      .expect(200);
    await yo().patch('/auth/me/language').send({ locale: 'es' }).expect(200);

    await expect(
      as(companero, tenant).get('/auth/me').expect(200).then(localeDe),
    ).resolves.toBe('en');
  });

  it('CRÍTICO: sin sesión no se puede cambiar el idioma de nadie', async () => {
    await http().patch('/auth/me/language').send({ locale: 'en' }).expect(401);
  });

  it('el idioma vive en la persona, no en la organización', async () => {
    // Se comprueba en la base de datos: si estuviera en `Organization.settings`, elegirlo se
    // lo cambiaría a toda la empresa.
    const empresa = await prisma.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
    });

    expect(JSON.stringify(empresa.settings)).not.toMatch(/locale/i);
    await expect(
      prisma.user
        .findUniqueOrThrow({ where: { id: tenant.owner.userId } })
        .then((user) => user.locale),
    ).resolves.toBe('es');
  });
});
