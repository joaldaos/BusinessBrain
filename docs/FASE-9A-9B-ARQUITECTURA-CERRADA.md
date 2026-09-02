# Fases 9A y 9B — Arquitectura cerrada

Especificación de construcción, conforme a las decisiones aprobadas el 2 de septiembre de 2026.
Sobre el commit `7d0bf87`.

Este documento cierra el diseño. Todavía **no se ha escrito código**.

---

## 1. Qué de tus decisiones ya está soportado

Lo primero que pediste: no reconstruir lo que funciona. Auditado decisión por decisión.

| Decisión | Estado real | Qué queda por hacer |
|---|---|---|
| **1. Dos vías** | Vía documental **completa**. Vía de hechos: **no existe** | Construir la vía de hechos |
| **1b. Convergencia** | **Ya especificada y aplicada en el pipeline** — ver §2 | Alimentarla con hechos y con una evidencia nueva |
| **2. Registro de hechos** | No existe | Dos tablas nuevas |
| **3. Veri\*factu no ahora** | Nada que hacer | — |
| **4. Cola durable** | No existe. `@Cron` en proceso. Redis está en `docker-compose` pero **el backend no lo usa** | Construir. Ver §3.2 |
| **5. Cifrado por organización** | Cifrado sólido (AES-256-GCM) con **una sola clave global**. 16 puntos de uso | Derivación por tenant. Ver §3.1 |
| **6. Plataforma sin secretos** | Se cumple **por omisión**: la plataforma no sabe que existen las integraciones | Proyección de metadatos + prueba estructural |
| **7. TPV comercial** | — | §7, línea paralela |

**Traducción:** la mitad de 9B ya está. Lo que falta de verdad es la vía de hechos y la cola.

---

## 2. La convergencia, explícita

Pediste que la diseñara de forma explícita. La conclusión de la auditoría es que **el punto de
encuentro ya existe, está especificado y el pipeline lo impone**. No hay que inventarlo: hay que
alimentarlo.

### 2.1 Dónde convergen las tres piezas

El mecanismo se llama `applyRiskOpportunityGate` y su regla es:

> Ningún `Insight` de tipo `RISK` u `OPPORTUNITY` puede persistirse sin al menos un
> `BusinessObjective` en estado `CONFIRMED` vinculado.

Y si no lo hay, no se descarta la información: **se degrada** al tipo que la estrategia declaró,
«despojada del juicio de valor que no puede justificar».

Eso es exactamente la convergencia que describes, y ya está construida:

| Tu pieza | Dónde vive |
|---|---|
| Hecho («el tiempo subió un 31 %») | `BusinessEvent` → señal → candidato (**por construir**) |
| Objetivo («reducir el tiempo de servicio») | `BusinessObjective` CONFIRMED → el gate lo exige (**existe**) |
| Conocimiento («si supera X, reforzar cocina») | Documento → `InsightEvidence` como corroboración (**existe**) |
| Conclusión empresarial | `Insight` → `narrarConclusion()` (**existe**) |
| Recomendación | `propose-from-insights.use-case.ts` (**existe**) |

### 2.2 Tu ejemplo, trazado de punta a punta

```
TPV                          Documentos                   Objetivos
 │                                │                            │
 │ ORDER_SENT_TO_KITCHEN 14:02    │ "si el tiempo de servicio  │ "Reducir el tiempo
 │ ORDER_READY           14:19    │  supera X, reforzar cocina"│  medio de servicio"
 │ …× 412 comandas                │                            │  status: CONFIRMED
 ▼                                ▼                            ▼
┌──────────────────────┐   ┌──────────────┐          ┌──────────────────┐
│ Métrica determinista │   │ Recuperación │          │  Gate de riesgo  │
│ mediana sáb 14-15 h  │   │  documental  │          │                  │
│ 6 semanas: +31 %     │   │              │          │                  │
└──────────┬───────────┘   └──────┬───────┘          └────────┬─────────┘
           │                      │                            │
           │ evidencia            │ evidencia                  │ ancla
           │ DEVIATION            │ CORROBORATION              │
           └──────────┬───────────┴────────────────────────────┘
                      ▼
              ┌───────────────┐
              │    Insight    │  type: RISK   (sin objetivo sería ANOMALY)
              │               │  confianza: 0.9 × calidad de la serie
              └───────┬───────┘
                      ▼
       «El servicio de los sábados a mediodía se está alejando
        de vuestro objetivo.»
       Qué hemos detectado · Por qué importa · Qué hacer
                      ▼
              Recomendación → decisión humana → constancia
```

**Lo que aporta cada pieza, y lo que pasa si falta:**

| Falta | Resultado | Correcto porque |
|---|---|---|
| Nada | `RISK` anclado al objetivo | Es un juicio de valor justificado |
| El **objetivo** | `ANOMALY`: «el tiempo ha subido» | Sin objetivo confirmado, decir que es un *riesgo* es una opinión nuestra |
| El **documento** | `RISK` igualmente, con una evidencia menos | El documento corrobora, no sostiene |
| El **hecho** | Nada | Sin medición no hay nada que decir |

### 2.3 Una honestidad sobre el «si supera X, reforzar cocina»

Es tentador prometer que BusinessBrain leerá esa frase del documento, extraerá el umbral, lo
comparará con la métrica y concluirá. **No voy a diseñarlo así**, y conviene que sepas por qué:

Extraer un umbral numérico de una frase en prosa y aplicarlo a una serie temporal es
precisamente donde un modelo de lenguaje falla de la forma más cara: produce un número
verosímil, la conclusión queda perfectamente redactada, y nadie la comprueba.

El diseño es más modesto y más sólido:

1. La **desviación** se detecta con aritmética. Determinista, reproducible, auditable.
2. El **objetivo** convierte la desviación en riesgo. Determinista: el gate ya lo hace.
3. El **documento** se adjunta como evidencia de corroboración, **citado, no interpretado** —
   la persona lee la política y juzga.

Si más adelante quieres umbrales explícitos, el sitio correcto es un campo del
`BusinessObjective` («no más de 20 minutos»), donde es un dato declarado por la empresa y no
una lectura nuestra de un PDF. **Eso lo propongo para 9D, no lo doy por decidido.**

### 2.4 La consecuencia que obliga a tocar el modelo

Hoy `InsightEvidenceKind` admite `KNOWLEDGE_ITEM`, `KNOWLEDGE_CHUNK`, `CANONICAL_ENTITY` y
`DERIVED_INSIGHT`. **Una métrica calculada sobre hechos no es ninguna de esas cosas.**

Sin una evidencia nueva, una conclusión de TPV solo podría persistirse sin evidencia — y una
conclusión sin evidencia rompe la promesa central del producto. Es el cambio de modelo que no
se puede evitar, y está detallado en §4.3.

---

## 3. Tres precisiones antes de implementar

Tu regla: si una decisión aprobada choca con una limitación técnica real, parar y explicarlo.
Ninguna de estas tres invalida una decisión. Las tres **acotan** cómo se cumple.

### 3.1 El cifrado por organización no puede cubrir el secreto de MFA

**El problema.** Hay 16 puntos de cifrado. Uno de ellos, `mfa.service.ts`, cifra el secreto TOTP
de un **usuario**, y un usuario no pertenece a una organización: puede estar en varias, y **el
administrador de plataforma no está en ninguna**. No existe un `organizationId` con el que
derivar su clave.

**Lo que propongo** — cumple tu decisión y no deja nada peor:

| Secreto | Clave derivada de | Ámbito |
|---|---|---|
| Tokens de integración, `configEnc`, claves de IA | maestra + `organizationId` | Organización |
| Secreto TOTP | maestra + `userId` | Usuario |

Misma técnica (HKDF-SHA256 sobre la clave maestra), distinto identificador. Sigue siendo cierto
que un secreto de una organización no puede descifrarse en el contexto de otra, y además un
secreto de MFA tampoco puede descifrarse en el contexto de otro usuario, que hoy sí podría.

**El segundo problema: los secretos ya cifrados.** Cambiar la derivación los vuelve ilegibles.
Nadie podría entrar con MFA ni sincronizar Drive.

Solución sin migración destructiva: **el formato lleva versión**. Hoy es `iv:tag:ct`; pasa a
`v2:iv:tag:ct`. Un payload sin prefijo se descifra con la clave maestra —como siempre— y se
reescribe con la clave derivada la próxima vez que se escriba. Los datos antiguos siguen
funcionando desde el primer día y migran solos.

### 3.2 La cola: Postgres, no Redis — y por qué

Dijiste «no sobrearquitectures». Estoy de acuerdo, y por eso propongo lo que parece la opción
menos moderna.

Redis está en `docker-compose`, así que BullMQ no añadiría nada al entorno de desarrollo. Pero
sí añade un almacén durable más en producción, y eso rompe algo que tu decisión 2 exige
explícitamente: **la idempotencia.**

Con la cola en Postgres, esto es una sola transacción:

```
BEGIN
  INSERT INTO "BusinessEvent" …        -- los hechos, con su unicidad por id externo
  UPDATE "ConnectorSync" SET cursor=…  -- el marcador avanza
  DELETE FROM "JobQueue" WHERE id=…    -- el trabajo se da por hecho
COMMIT
```

Con la cola en Redis no lo es. Entre confirmar el trabajo en Redis y confirmar los hechos en
Postgres hay una ventana; si el proceso cae ahí, o se pierden hechos o se duplican. Se resuelve,
pero se resuelve con más código del que ahorra usar Redis.

Añadido: una PYME que despliegue esto no tiene que operar un Redis, y no hay una segunda cosa
que respaldar (`COPIA_Y_RESTAURACION.md` sigue valiendo tal cual).

**Lo que construyo:** tabla `JobQueue`, un despachador que toma trabajos con `FOR UPDATE SKIP
LOCKED`, reintento con espera creciente, tope de intentos y cola de fallidos. Sin prioridades,
sin *cron* distribuido, sin panel. Unas 200 líneas.

**Cuándo revisarlo:** si un cliente supera ~50 trabajos por segundo sostenidos. Está a años de
distancia, y para entonces el puerto ya estará ahí para cambiar el motor sin tocar a quien lo usa.

**Si prefieres Redis/BullMQ, dilo y lo construyo así.** Es una decisión defendible; solo quería
que supieras que la barata aquí es la aburrida.

### 3.3 Añadir evidencia de métrica toca una restricción existente

`InsightEvidence` tiene una restricción `CHECK` en la base
(`InsightEvidence_ref_matches_kind`) que garantiza que la referencia polimórfica sea coherente
con `kind`. Está puesta a propósito, «para que ninguna vía de escritura pueda saltárselo».

Añadir `BUSINESS_METRIC` obliga a **eliminar y recrear esa restricción** en una migración. No es
peligroso —no toca datos, solo la regla— pero no es un `ALTER TABLE ADD COLUMN` inocuo y no
quiero que aparezca en un diff sin haberlo dicho antes.

---

## 4. Cambios de modelo de datos

Tu decisión 9: exactamente qué y por qué, nada arbitrario. Son **cinco**.

### 4.1 `BusinessEvent` y `BusinessEntity` (nuevas)

Las de §D.2 del informe anterior, sin cambios. Justificación: es la decisión 2.

La unicidad `(organizationId, connectorId, kind, externalId)` **es** la idempotencia. No es un
índice de rendimiento: es la garantía de que un webhook reenviado no duplica una venta.

### 4.2 `OrganizationConnector` y `ConnectorSync` (nuevas)

`OrganizationConnector`: qué conector está activo en qué empresa, con qué ámbito y en qué estado.
Gemelo de `KnowledgeSource` para la otra vía. **No reutilizo `KnowledgeSource`**: sus invariantes
—pertenecer a colecciones, producir `KnowledgeItem`— no se cumplen aquí, y una fila que las
incumpla envenenaría el alcance de conocimiento, que es lo que sostiene los permisos.

`ConnectorSync`: una fila por ejecución, con estadísticas y error. Gemelo de `IngestionJob`. Sin
histórico no hay diagnóstico, y la plataforma (decisión 6) no tendría nada que enseñar.

### 4.3 `InsightEvidenceKind` += `BUSINESS_METRIC` (modificación)

```prisma
enum InsightEvidenceKind {
  KNOWLEDGE_ITEM
  KNOWLEDGE_CHUNK
  CANONICAL_ENTITY
  DERIVED_INSIGHT
  BUSINESS_METRIC   // ← nuevo
}

model InsightEvidence {
  …
  businessMetricId String?   // ← nueva columna, apunta a BusinessMetricWindow
}
```

**Por qué es imprescindible:** sin esto una conclusión sobre datos de TPV no puede citar de
dónde sale. Sería la primera conclusión del producto sin evidencia, y con eso caería el «Ver el
detalle técnico», el anexo del PDF y la regla de no afirmar sin respaldo. Sería exactamente el
«importador de datos» contra el que avisas.

Requiere recrear la restricción `CHECK` (§3.3).

### 4.4 `BusinessMetricWindow` (nueva)

La evidencia de §4.3 tiene que apuntar a algo estable. Una métrica no es una fila de hechos: es
**una ventana y un cálculo sobre muchas**.

```prisma
model BusinessMetricWindow {
  id             String   @id @default(cuid())
  organizationId String
  metricKey      String   // "kitchen.prep_time_p50"
  dimensions     Json     // { weekday: 6, hourBucket: 14 }
  windowStart    DateTime
  windowEnd      DateTime
  value          Decimal
  sampleSize     Int      // cuántos hechos la sostienen
  computedAt     DateTime @default(now())

  @@unique([organizationId, metricKey, dimensions, windowStart, windowEnd])
}
```

`sampleSize` no es adorno: **es lo que permite callarse**. Una mediana sobre 4 comandas no se
enseña. Es la misma regla que ya impide sintetizar con menos de N fragmentos.

### 4.5 `Integration` (ampliación no destructiva)

`+ connectorKey String?`, `+ authKind`, `+ secretEnc String?`, `+ revokedAt DateTime?`. Las
columnas actuales de Google se conservan intactas: nada de lo que funciona se toca.

### 4.6 Lo que NO se toca

`KnowledgeSource`, `KnowledgeItem`, `KnowledgeChunk`, `Insight`, `AnalysisRun`,
`BusinessObjective`, `Recommendation`, `Report`, `User`, `Membership`, `PlatformAccessGrant`,
`AuditLog`. Cero cambios.

---

## 5. Qué voy a implementar

### Fase 9A — infraestructura

1. **Cola durable en Postgres**: `JobQueue`, despachador, reintentos, cola de fallidos.
2. **`BusinessConnectorPort`** con `capabilities`, `pull`, `receive`, `health`.
3. **`BusinessConnectorRegistry`**, gemelo del existente.
4. **`BusinessEvent` / `BusinessEntity`** y el servicio de escritura idempotente.
5. **`OrganizationConnector` / `ConnectorSync`** y el ciclo de vida: conectar, sincronizar,
   diagnosticar, desconectar.
6. **Corrección de la fuga del core**: `describeScope()` pasa al conector y desaparece el
   `switch` de `knowledge-sources.service.ts:232`.

### Fase 9B — seguridad y superficie

7. **Derivación de claves por tenant**, con formato versionado y compatibilidad hacia atrás.
8. **`secretEnc` genérico + `authKind`** en `Integration`.
9. **Superficie de webhooks**: verificación de firma, ventana anti-reenvío, idempotencia, topes.
10. **Proyección de plataforma**: estado, última sincronización, errores. Sin secretos.
11. **Topes por organización** en `UsageRecord`, que ya existe.

### Pruebas estructurales (con el código, no después)

- Ningún secreto en ninguna respuesta HTTP, log o `AuditLog`.
- `secretEnc` fuera de toda proyección de plataforma.
- Un secreto de A no se descifra en el contexto de B.
- El mismo hecho dos veces produce una fila.
- El marcador solo avanza tras persistir.
- Ningún nombre de proveedor fuera de su carpeta de conector.
- Una capacidad no declarada no se ofrece.
- Toda regresión existente sigue verde. **No se relaja ninguna prueba.**

---

## 6. Qué NO voy a implementar

| No haré | Por qué |
|---|---|
| Ningún conector concreto | Lo pediste: primero cerrar arquitectura |
| Veri\*factu, en ninguna forma | Decisión 3 |
| WhatsApp | Fuera de 9A/9B |
| Pantalla de Integraciones | Sin conectores no hay nada que enseñar. Va en 9E |
| La estrategia de señales operativas | Es 9D. La arquitectura la deja preparada |
| Extracción de umbrales de documentos | §2.3 |
| `ConnectorDefinition`, `ConnectorCapability`, `ConnectorError` | Código o atributos, no tablas |
| Cambios en el modelo documental | Funciona |
| Redis / BullMQ | §3.2, salvo que digas lo contrario |
| Métricas por empleado | Se puede, y no se hace por defecto |
| Decidir el modelo de negocio | Decisión 8: esperando |

---

## 7. Línea comercial de TPV (decisión 7)

En paralelo, sin comprometer implementación. Lo que hay que averiguar de cada fabricante:

| | API pública | Webhooks | Ciclo de comanda | Acceso | Coste | Partnership |
|---|---|---|---|---|---|---|
| Glop | «API opcional» — confirmar | ? | ? | ? | ? | ? |
| Camarero10 | ? | ? | módulo cocina | ? | ? | ? |
| Ágora | ? | ? | ? | ? | ? | ? |
| Cegid Revo | ? | ? | ? | ? | ? | ? |
| Hosteltáctil | ? | ? | ? | ? | ? | ? |
| Square | **sí, pública** | sí | parcial | autoservicio | gratis | no hace falta |
| Lightspeed | **sí, pública** | sí | sí | portal | gratis/plan | sí |

**El dato que decide** es la cuarta columna del ciclo de comanda: si el TPV entrega la hora de
*enviado a cocina* y la de *listo*. Sin esas dos, el caso de uso de tiempos no existe y el
conector vale mucho menos.

**Recomendación táctica:** empezar por Square o Lightspeed. No porque sean el mercado objetivo
—no lo son— sino porque se puede construir y validar el conector **hoy, sin esperar a ningún
acuerdo**. Cuando llegue el acuerdo con un fabricante español, la arquitectura ya estará probada
contra un proveedor real en vez de contra un simulador.

---

## 8. Lo que necesito de ti para empezar

Solo dos cosas. Todo lo demás está decidido.

1. **¿Cola en Postgres o en Redis?** Recomiendo Postgres (§3.2). Si no dices nada, sigo con
   Postgres.
2. **¿Confirmas los cinco cambios de modelo de §4?** En particular el 4.3, que recrea una
   restricción existente.

Las precisiones de §3.1 (MFA por usuario) y §3.3 no son decisiones nuevas: son cómo se cumplen
las que ya aprobaste. Las aplico salvo que digas lo contrario.

Con tu respuesta empiezo por la cola y el registro de hechos, en ese orden, un cambio por
commit.
