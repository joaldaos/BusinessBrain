-- Fase 7 — Memoria de la Creencia: unicidad de sujeto por EXCLUSION de estados terminales.
--
-- SIN CAMBIOS DE MODELO: no crea ni altera tablas, columnas ni enums. Solo redefine el
-- predicado de un indice unico parcial ya existente.
--
-- ## Por que
--
-- UNDERSTANDING_ENGINE_DESIGN.md §370 es explicito sobre COMO debe definirse esta
-- restriccion: "definida por exclusion de los estados terminales (SUPERADO, DESCARTADO,
-- EXPIRADO, §5) y NO por inclusion de los activos — exactamente el criterio fail-closed que
-- KNOWLEDGE_ENGINE_DESIGN.md §7 ya razono para la idempotencia de la ingesta: ante un estado
-- nuevo todavia sin clasificar, el sistema falla del lado seguro".
--
-- El indice creado en 3.1 hacia lo contrario: `WHERE "status" = 'ACTIVE'`, es decir, por
-- INCLUSION. Su comentario citaba el criterio correcto, pero el predicado no lo implementaba.
--
-- Mientras el unico estado escrito fue ACTIVE la diferencia era inocua. Deja de serlo en esta
-- fase por dos motivos:
--
-- 1. La Fase 7 empieza a escribir SUPERSEDED de verdad, y la correccion de la cadena depende
--    de que superar una version LIBERE el hueco del sujeto. Con exclusion eso es explicito.
-- 2. Con inclusion, cualquier estado futuro sin clasificar quedaria FUERA de la restriccion:
--    dos Insight vivos del mismo asunto podrian coexistir sin que nada fallara. Es
--    exactamente el fail-open que §370 razona para evitarlo.
--
-- ## Seguridad
--
-- Comprobado contra los datos reales antes de escribirla: 4 Insight, todos ACTIVE, cero pares
-- (organizacion, sujeto) duplicados entre estados no terminales. La creacion del indice nuevo
-- no puede fallar por colision.
--
-- El orden importa: se crea el indice nuevo ANTES de retirar el antiguo, de modo que en
-- ningun instante el sujeto queda sin proteccion de unicidad.

CREATE UNIQUE INDEX "Insight_org_subject_non_terminal_key"
  ON "Insight" ("organizationId", "subjectIdentity")
  WHERE "status" NOT IN ('SUPERSEDED', 'DISCARDED', 'EXPIRED');

DROP INDEX "Insight_org_subject_active_key";
