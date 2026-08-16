-- Fase 6, subfase 6.3 — backfill de concesiones de coleccion.
--
-- SIN CAMBIOS DE ESQUEMA: es una migracion de DATOS. No crea, altera ni borra ninguna
-- columna, tabla, indice ni restriccion.
--
-- ## Por que existe
--
-- Hasta 6.3 el chat sin `agentId` leia TODO el conocimiento de la organizacion, mientras que
-- las recomendaciones y la comprension ya se acotaban por las colecciones concedidas a cada
-- persona (5.8). Convivian dos criterios de acceso al mismo conocimiento segun por que puerta
-- se entrara. 6.3 unifica el criterio: usuario -> colecciones concedidas.
--
-- Aplicar esa unificacion sin backfill dejaria el chat mudo para todo el mundo de un dia para
-- otro, porque hoy no existe ninguna concesion. Este backfill concede a cada miembro las
-- colecciones que YA podia leer de hecho a traves del chat, de modo que el comportamiento
-- observable no cambia y la restriccion pasa a ser una decision de negocio explicita —retirar
-- accesos— en lugar de un efecto colateral de una migracion.
--
-- ## Por que es seguro
--
-- - No amplia el acceso de nadie: concede exactamente lo que el chat sin agente ya exponia.
-- - No cruza organizaciones: el JOIN empareja miembro y coleccion por `organizationId`, y la
--   FK compuesta contra (id, organizationId) lo haria imposible aunque el JOIN fallara.
-- - Es IDEMPOTENTE: `ON CONFLICT DO NOTHING` sobre el unico (knowledgeCollectionId, userId).
--   Reejecutarla no duplica ni reescribe la traza de una concesion existente.
-- - `grantedById` queda NULO a proposito: nadie concedio esto, lo hizo la migracion. Atribuirlo
--   a una persona seria falsificar la traza de auditoria que la Fase 6.2 acaba de construir.
--
-- ## Estado real comprobado antes de escribirla
--
-- 18 organizaciones, 13 membresias, 5 colecciones, 0 concesiones y 4 pares (miembro,
-- coleccion) que corresponden. Volumen trivial en este entorno; la consulta es de todos modos
-- un unico INSERT ... SELECT, sin bucles ni cursores.

INSERT INTO "KnowledgeCollectionAccess" (
  "id",
  "organizationId",
  "knowledgeCollectionId",
  "userId",
  "grantedById",
  "createdAt"
)
SELECT
  -- cuid() no existe en Postgres; un identificador aleatorio estable es suficiente y no
  -- colisiona con los cuid de la aplicacion.
  'bf_' || replace(gen_random_uuid()::text, '-', ''),
  m."organizationId",
  c."id",
  m."userId",
  NULL,
  NOW()
FROM "Membership" m
JOIN "KnowledgeCollection" c ON c."organizationId" = m."organizationId"
ON CONFLICT ("knowledgeCollectionId", "userId") DO NOTHING;
