import type { PrismaService } from '../../src/prisma/prisma.service';
import { isNovelSubject } from '../../src/understanding-engine/domain/subject-identity';
import {
  createKnowledgeItem,
  createTestOrg,
  destroyTestOrg,
  prisma,
  subjectIdentity,
  type TestOrg,
} from './fixtures';

/**
 * `ResolveSubjectIdentity` contra Postgres real — Fase 7.2.
 *
 * Lo que un doble no puede demostrar: que el referente EXISTE de verdad y que pertenece a
 * ESTA organización. Sin esa comprobación, dos tenants podrían compartir identidad de sujeto
 * y sus creencias reconciliarían entre sí sin que ninguna restricción lo delatara.
 */
describe('Identidad de sujeto (integración)', () => {
  const db = prisma as unknown as PrismaService;
  const resolver = () => subjectIdentity(db);
  let org: TestOrg;

  beforeEach(async () => {
    org = await createTestOrg('subject-id');
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('acuña la identidad canónica de un referente real', async () => {
    const item = await createKnowledgeItem(org, { title: 'Política' });

    const resolved = await resolver().resolve({
      organizationId: org.orgId,
      proposal: {
        referentType: 'knowledge-item',
        referentId: item.id,
        aspect: 'confianza',
      },
    });

    expect(resolved).toEqual({
      value: `knowledge-item:${item.id}#confianza`,
      reason: 'DERIVED',
      referent: {
        type: 'knowledge-item',
        id: item.id,
        aspect: 'confianza',
      },
    });
  });

  it('dos estrategias que nombran el MISMO referente y aspecto llegan al mismo asunto', async () => {
    const item = await createKnowledgeItem(org);
    const proposal = {
      referentType: 'knowledge-item' as const,
      referentId: item.id,
      aspect: 'confianza' as const,
    };

    const [una, otra] = await Promise.all([
      resolver().resolve({ organizationId: org.orgId, proposal }),
      resolver().resolve({ organizationId: org.orgId, proposal }),
    ]);

    // La propiedad que era estructuralmente imposible antes de 7.2, cuando cada estrategia
    // anteponía su propia clave a la identidad.
    expect(una.value).toBe(otra.value);
  });

  it('el ASPECTO separa creencias distintas sobre el mismo documento', async () => {
    const item = await createKnowledgeItem(org);

    const confianza = await resolver().resolve({
      organizationId: org.orgId,
      proposal: {
        referentType: 'knowledge-item',
        referentId: item.id,
        aspect: 'confianza',
      },
    });
    const coherencia = await resolver().resolve({
      organizationId: org.orgId,
      proposal: {
        referentType: 'knowledge-item',
        referentId: item.id,
        aspect: 'coherencia',
      },
    });

    expect(confianza.value).not.toBe(coherencia.value);
  });

  describe('ante duda, sujeto NUEVO — jamás una aproximación (§3.4)', () => {
    it('la abstención de la estrategia produce un sujeto opaco', async () => {
      const resolved = await resolver().resolve({
        organizationId: org.orgId,
        proposal: { novel: true },
      });

      expect(resolved.reason).toBe('ABSTAINED');
      expect(isNovelSubject(resolved.value)).toBe(true);
      expect(resolved.referent).toBeUndefined();
    });

    it('dos abstenciones NO comparten asunto', async () => {
      // Compartirlo sería fusionar por la puerta de atrás: dos creencias sin relación
      // acabarían superándose la una a la otra.
      const [a, b] = await Promise.all([
        resolver().resolve({
          organizationId: org.orgId,
          proposal: { novel: true },
        }),
        resolver().resolve({
          organizationId: org.orgId,
          proposal: { novel: true },
        }),
      ]);

      expect(a.value).not.toBe(b.value);
    });

    it('un referente INEXISTENTE no ancla nada', async () => {
      const resolved = await resolver().resolve({
        organizationId: org.orgId,
        proposal: {
          referentType: 'knowledge-item',
          referentId: 'no-existe',
          aspect: 'confianza',
        },
      });

      expect(resolved.reason).toBe('INVALID_PROPOSAL');
      expect(isNovelSubject(resolved.value)).toBe(true);
    });

    it('CRÍTICO: un referente de OTRA organización no ancla nada', async () => {
      const otra = await createTestOrg('subject-id-otra');
      const suyo = await createKnowledgeItem(otra, { title: 'Ajeno' });

      const resolved = await resolver().resolve({
        organizationId: org.orgId,
        proposal: {
          referentType: 'knowledge-item',
          referentId: suyo.id,
          aspect: 'confianza',
        },
      });

      // Si se aceptara, ambos tenants compartirían identidad de sujeto y sus creencias
      // reconciliarían entre sí. La unicidad es por (organización, sujeto), así que no
      // habría colisión visible: la fuga sería silenciosa.
      expect(resolved.reason).toBe('INVALID_PROPOSAL');
      expect(isNovelSubject(resolved.value)).toBe(true);
      expect(resolved.value).not.toContain(suyo.id);

      await destroyTestOrg(otra);
    });

    it('una propuesta mal formada no ancla nada', async () => {
      const resolved = await resolver().resolve({
        organizationId: org.orgId,
        proposal: {
          referentType: 'factura',
          referentId: 'x',
          aspect: 'confianza',
        } as never,
      });

      expect(resolved.reason).toBe('INVALID_PROPOSAL');
      expect(isNovelSubject(resolved.value)).toBe(true);
    });
  });

  it('resuelve cada tipo del catálogo contra su entidad real', async () => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Ventas' },
    });

    const porColeccion = await resolver().resolve({
      organizationId: org.orgId,
      proposal: {
        referentType: 'knowledge-collection',
        referentId: collection.id,
        aspect: 'cobertura',
      },
    });
    const porFuente = await resolver().resolve({
      organizationId: org.orgId,
      proposal: {
        referentType: 'knowledge-source',
        referentId: org.sourceId,
        aspect: 'disponibilidad',
      },
    });

    expect(porColeccion.reason).toBe('DERIVED');
    expect(porFuente.reason).toBe('DERIVED');
  });
});
