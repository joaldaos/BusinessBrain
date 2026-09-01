# Fase 9 — Informe de arquitectura y viabilidad de las integraciones

Documento de decisión. No se ha implementado ninguna integración: lo que sigue es auditoría,
diseño, viabilidad y coste, para decidir qué se construye después y en qué orden.

Fecha del análisis: 1 de septiembre de 2026 · Sobre el commit `73060ea`.

---

## Resumen para decidir en dos minutos

1. **Ya existe un sistema de conectores.** Cuatro implementaciones vivas, custodia de
   credenciales cifrada, OAuth con refresco y revocación, histórico de sincronizaciones y
   auditoría. No hay que inventarlo: hay que **generalizarlo**.

2. **Pero todos los conectores actuales producen documentos.** Un TPV no produce documentos:
   produce hechos con fecha y número. Meter un ticket por la vía del documento —trocear,
   vectorizar, recuperar por semejanza— haría imposible responder «¿cuánto se tarda los
   sábados?». Ese es el hueco real de la Fase 9, y es de arquitectura, no de código.

3. **El motor de comprensión no hay que tocarlo.** Ya consume «señales con hechos» y ya sabe
   contarlas en lenguaje de negocio sin llamar a ningún modelo. Un conector nuevo añade una
   señal, no reescribe el cerebro.

4. **Veri\*factu: ámbar tirando a rojo, y probablemente la integración equivocada.** Leer
   facturas ya emitidas está fuera del reglamento y es viable. Emitirlas o encadenarlas nos
   convierte en SIF, con 150.000 € por ejercicio de exposición. Y para el valor que
   buscamos, el software de facturación del cliente es mejor fuente que la AEAT.

5. **Restaurante: el mejor caso de valor, y un problema comercial antes que técnico.** La
   cadena datos → señal → recomendación funciona. Lo que falla es que los TPV españoles de
   hostelería no publican API abierta.

6. **Falta una pieza de infraestructura sin la cual nada de esto aguanta**: una cola durable.
   Hoy solo hay un `@Cron` en proceso.

---

## A. Estado actual

### A.1 Lo que ya existe y sirve

Esto no es teoría: está en el repositorio y tiene pruebas.

| Pieza | Dónde | Qué resuelve ya |
|---|---|---|
| `ConnectorPort` | `knowledge-engine/domain/ports/connector.port.ts` | Contrato de conector: `key`, `acquisition: PUSH\|PULL`, `requiresRestrictedCollection`, `extract()` |
| `ConnectorRegistry` | `knowledge-engine/infrastructure/connectors/` | Único punto que sabe qué conectores existen. Nadie instancia uno directamente |
| 4 conectores | `file_upload`, `web_page`, `google_drive`, `gmail` | Prueba de que la abstracción aguanta más de un proveedor |
| `Integration` (Prisma) | `schema.prisma:1193` | Custodia de la conexión: tokens cifrados, `scope`, `expiresAt`, `accountLabel`, `connectedById` |
| `IntegrationsService` | `integrations/application/` | OAuth completo: consentimiento, refresco con margen, detección de revocación, desconexión que **revoca aguas arriba** |
| `EncryptionService` | `common/utils/encryption.util.ts` | AES-256-GCM, formato autocontenido `iv:authTag:ciphertext` |
| `KnowledgeSource` | `schema.prisma:561` | Config por organización: `connectorKey`, `configEnc`, `status`, `lastSyncedAt`, `lastError`, `syncCursor` |
| `IngestionJob` | `schema.prisma:619` | Una fila por sincronización, con `stats` y `error` |
| `AuditLog` | `schema.prisma:1238` | Traza de operaciones, con redacción (`audit/domain/audit-redaction.ts`) |
| `UsageRecord` | `schema.prisma:1273` | Consumo por organización, métrica y periodo, con unicidad que impide contar de menos |
| `PlatformAccessGrant` | `schema.prisma:432` | Concesiones METADATA / DIAGNOSTICS / CONTENT |

**Traducción:** entre el 60 % y el 70 % de lo que las fases 9A y 9B iban a construir ya está
construido. Para conectores de documentos.

### A.2 Detalles del diseño actual que conviene conservar

Tres decisiones ya tomadas que son correctas y que la Fase 9 debe respetar, no rehacer:

- **`syncCursor` fuera de `configEnc`.** El marcador de «por dónde iba» no es un secreto y no
  debe obligar a descifrar el bloque entero en cada sincronización. Un conector de TPV
  necesitará exactamente lo mismo.
- **`requiresRestrictedCollection`.** Declarado por el conector, no comprobado por clave desde
  fuera. Quien añada una fuente sensible solo tiene que declararlo. El mismo mecanismo sirve
  para los datos de un TPV, que son igual de sensibles que un buzón.
- **Desconectar no borra.** «Las fuentes quedan en ERROR, no se borran: su conocimiento ya
  ingerido sigue siendo válido.» Esa regla debe extenderse tal cual a los datos operativos.

### A.4 La frontera core/proveedor: ya hay una fuga, y es pequeña

La pregunta era cómo evitar que el core acabe conociendo proveedores. Hoy casi se cumple, pero
no del todo. En `knowledge-sources.service.ts:232` hay un `switch` sobre la clave del conector:

```ts
switch (connectorKey) {
  case 'gmail_v1':        return text(config.labelName) ?? text(config.labelId);
  case 'web_page_v1':     return text(config.url);
  case 'google_drive_v1': return text(config.folderName) ?? text(config.folderId);
  default:                return null;
}
```

Está bien razonado —es lista blanca precisamente para que la config, que puede llevar secretos,
no se vuelque entera— y falla cerrado. Pero es conocimiento de proveedor **en un servicio del
núcleo**, y con diez conectores ese `switch` es inmanejable.

**Corrección propuesta:** que sea el conector quien declare `describeScope(config): string |
null`. Se mantiene la lista blanca —cada conector expone solo lo suyo—, desaparece el `switch`,
y añadir un conector deja de tocar el core. Es un cambio pequeño y conviene hacerlo en 9A,
antes de que haya diez casos que migrar.

### A.3 Cómo llega hoy algo a ser una conclusión

Esto es lo que determina si el core hay que tocarlo o no:

```
KnowledgeSignal { kind, subjectKind, subjectId, observedAt, facts }
        ↓
ReasoningStrategy.generate(context)  →  InsightCandidate { summary, evidence, reasoningTrace }
        ↓
resolución de conflicto + gate de riesgo/oportunidad
        ↓
Insight  →  narrarConclusion()  →  pantalla y PDF en lenguaje de negocio
```

**El puerto de señales ya entrega hechos objetivos, no veredictos**, y `facts` ya es un
diccionario libre. `narrarConclusion()` ya convierte una señal en las cuatro frases que lee un
empresario, **sin llamar a ningún modelo de lenguaje**.

Consecuencia, y es la conclusión más importante de esta auditoría: **añadir el TPV no exige
tocar el motor de comprensión.** Exige un puerto gemelo de señales, una estrategia nueva y una
entrada más en el narrador. Tres ficheros nuevos, cero ficheros reescritos.

---

## B. Qué falta

### B.1 El hueco real: los conectores actuales producen documentos

```ts
export interface ExtractedContent {
  title: string;
  mimeType: string;
  rawContent: Buffer;   // ← aquí está el problema
  ...
}
```

Todo lo que entra por `ConnectorPort` acaba siendo un `KnowledgeItem`: se normaliza a texto, se
trocea, se vectoriza y se recupera **por semejanza semántica**.

Eso es lo correcto para un PDF de política de descuentos. Es ruinoso para un ticket:

- «¿Cuánto se tarda de media en salir un plato los sábados?» es una **media sobre una serie
  temporal**. Un índice vectorial no la calcula: la aproxima, y aproximar una media es
  inventarla.
- 2.000 tickets al día vectorizados son 2.000 llamadas de *embedding* al día por cliente, para
  producir un índice que responde peor que un `AVG()`.
- La regla que ya defiende el producto —«nunca inventar»— se rompería sola: el sistema daría
  cifras verosímiles y no comprobables.

**Conclusión:** hace falta una segunda familia de conectores, no una ampliación de la primera.
Los documentos van por semejanza; los hechos, por aritmética.

### B.2 Lo demás que falta

| Hueco | Por qué bloquea | Gravedad |
|---|---|---|
| **No hay cola durable** | Solo `@Cron` en proceso (`automations.module.ts`). Un webhook de TPV a 200/hora, o un reintento de remisión, no se sostienen ahí: si el proceso se reinicia, se pierde | **Bloqueante** para 9E y 9D |
| **No hay superficie de webhooks entrante** | Ni verificación de firma, ni protección contra reenvío, ni idempotencia | Bloqueante para todo lo que sea *push* |
| **No hay modelo normalizado** | Sin él, cada conector escribe en su propio formato y el core acaba conociendo proveedores | Bloqueante |
| **`Integration` tiene forma de OAuth de Google** | `accessTokenEnc` / `refreshTokenEnc` / `scope` / `expiresAt`. Una clave de API, un certificado o un usuario/contraseña no encajan | Alta |
| **La plataforma no ve nada de las integraciones** | Cero referencias a `Integration` en `platform/` y `platform-access/`. Hoy el administrador no puede ni saber si la conexión de un cliente está caída | Media (y hoy es un fallo seguro, no una fuga) |
| **`IntegrationProvider` es un enum cerrado** | `HUBSPOT, SALESFORCE, GOOGLE_DRIVE, GMAIL, SLACK, SAP, ZENDESK, CUSTOM`. Cada proveedor nuevo es una migración | Media |
| **Sin librería de XML ni de firma** | Veri\*factu lo exige | Solo afecta a 9D |

---

## C. Arquitectura recomendada

### C.1 El principio: dos vías, un solo cerebro

```
       LO QUE LA EMPRESA YA USA
   ┌─────────────┬──────────────┬───────────────┬──────────────┐
   │ Drive/Gmail │  Facturación │  TPV/comandas │ Stripe/Shopify│
   └──────┬──────┴───────┬──────┴───────┬───────┴───────┬──────┘
          │              │              │               │
   ┌──────▼──────┐  ┌────▼──────────────▼───────────────▼──────┐
   │ CONECTOR DE │  │        CONECTOR DE HECHOS                │
   │ DOCUMENTOS  │  │  (nuevo — normaliza a modelo común)      │
   │  (existe)   │  └────────────────────┬─────────────────────┘
   └──────┬──────┘                       │
          │                              │
   ┌──────▼──────────┐        ┌──────────▼──────────────────────┐
   │  KnowledgeItem  │        │  BusinessEntity + BusinessEvent │
   │  chunks · vect. │        │  serie temporal · aritmética    │
   └──────┬──────────┘        └──────────┬──────────────────────┘
          │                              │
   ┌──────▼──────────┐        ┌──────────▼──────────┐
   │ KnowledgeSignals│        │  BusinessSignals    │   ← puertos gemelos
   │    Port (existe)│        │  Port (nuevo)       │      mismo contrato
   └──────┬──────────┘        └──────────┬──────────┘
          └──────────────┬───────────────┘
                         │
              ┌──────────▼───────────┐
              │  UNDERSTANDING ENGINE│   ← NO SE TOCA
              │  estrategias · gate  │
              └──────────┬───────────┘
                         │
                    ┌────▼────┐
                    │ Insight │   ← un solo idioma, una sola trazabilidad
                    └────┬────┘
                         │
      ┌──────────┬───────┴───────┬──────────────┐
      │ Pantalla │ Recomendación │ Informe PDF  │
      └──────────┴───────────────┴──────────────┘
```

**Por qué convergen en `Insight` y no antes:** porque es lo único que ya sabe llevar evidencia,
confianza, vigencia, decisión humana y traducción a lenguaje de negocio. Un hallazgo de TPV que
no pasara por ahí sería un segundo producto dentro del producto, con su propia pantalla, su
propio PDF y su propia manera de equivocarse.

### C.2 El contrato del conector de hechos

```ts
/** Lo que un conector declara SABER HACER. Lo que no está declarado, no se ofrece. */
export interface ConnectorCapabilities {
  entities: BusinessEntityKind[];     // qué maestros trae
  events: BusinessEventKind[];        // qué hechos trae
  delivery: 'WEBHOOK' | 'POLL' | 'BOTH';
  /** Marcas de tiempo intermedias que el proveedor entrega de verdad. */
  timestamps: BusinessTimestamp[];
  backfill: boolean;                  // ¿puede traer histórico?
}

export interface BusinessConnectorPort {
  readonly key: string;               // "glop_v1", "stripe_v1"
  readonly capabilities: ConnectorCapabilities;

  /** Trae hechos nuevos desde el marcador. Idempotente por `externalId`. */
  pull(ctx: ConnectorContext, cursor: unknown): Promise<NormalizedBatch>;

  /** Normaliza un envío entrante ya verificado. */
  receive(ctx: ConnectorContext, payload: unknown): Promise<NormalizedBatch>;

  /** ¿Sigue viva la conexión? Sin efectos secundarios. */
  health(ctx: ConnectorContext): Promise<ConnectorHealth>;
}
```

`capabilities` es la pieza que hace honesto al producto. **Una métrica cuyo dato de entrada no
está declarado no se enseña, no se estima y no se aproxima.** Si el TPV no da la hora de «plato
terminado», la pantalla de tiempos de cocina no aparece — y dice por qué. Es exactamente la
misma regla que ya aplica `narrarConclusion` cuando le falta un hecho.

### C.3 Ciclo de vida, y qué NO va en el core

| Etapa | Quién decide | Dónde vive |
|---|---|---|
| Descubrir qué conectores existen | Registro | Código (`BusinessConnectorRegistry`) |
| Conectar / consentir | Servicio común | `integrations/` |
| Custodiar el secreto | Servicio común | `EncryptionService` |
| Traer datos | Conector | `connectors/<proveedor>/` |
| **Normalizar** | **Conector** | `connectors/<proveedor>/` |
| Persistir hechos | Servicio común | `business-data/` (nuevo) |
| Detectar señales | Estrategia | `understanding-engine/` |
| Explicar | Narrador | `insight-narrative.ts` |

**La frontera:** el nombre de un campo de un proveedor no puede aparecer fuera de su carpeta de
conector. Es comprobable con una prueba estructural, igual que la que hoy impide colores
Tailwind sueltos en las páginas de cliente.

---

## D. Modelo de datos propuesto

### D.1 Qué NO crear

De los siete modelos que planteabas, **recomiendo crear tres y descartar cuatro**:

| Propuesto | Veredicto | Por qué |
|---|---|---|
| `ConnectorDefinition` | ❌ **No** | Es código, no datos. Una tabla que describe qué conectores existen se desincroniza del registro el primer día |
| `ConnectorCapability` | ❌ **No** | Ídem. Se declara en el conector y se lee del registro |
| `ConnectorCredential` | ❌ **No** | Ya existe: `Integration` con sus columnas cifradas. Solo hay que generalizarla |
| `ConnectorError` | ❌ **No** | Un error es un atributo de un intento, no una entidad. Ya hay `lastError` + `AuditLog` |
| `OrganizationConnector` | ✅ **Sí** | Es lo único que falta de verdad: la configuración de un conector en una empresa |
| `ConnectorSync` | ✅ **Sí** | Gemelo de `IngestionJob`. Sin histórico por ejecución no hay diagnóstico posible |
| `ConnectorEvent` | ✅ **Sí, renombrado** | Es el corazón: `BusinessEvent` |

Menos tablas de las que pedías, y ninguna que no gane su sitio.

### D.2 El modelo normalizado: dos tablas, no trece

Listabas trece conceptos: Customer, Supplier, Product, Sale, Invoice, Payment, Order,
OrderItem, Employee, Location, BusinessEvent, KitchenOrder, Delivery.

**Trece tablas son un ERP.** Y los trece se reducen a dos formas:

- Unos son **cosas que persisten y tienen nombre**: cliente, proveedor, producto, empleado,
  local.
- Otros son **cosas que ocurren y tienen hora**: una venta, una factura, un cobro, una comanda,
  un plato listo, una entrega.

```prisma
/// Un maestro externo, tal como lo llama su sistema de origen.
model BusinessEntity {
  id             String  @id @default(cuid())
  organizationId String
  connectorId    String              // de qué conexión vino
  kind           BusinessEntityKind  // CUSTOMER | SUPPLIER | PRODUCT | EMPLOYEE | LOCATION
  externalId     String              // su id en el sistema de origen
  displayName    String
  attributes     Json    @default("{}")
  firstSeenAt    DateTime @default(now())
  lastSeenAt     DateTime

  /// Dos sincronizaciones del mismo cliente son el mismo cliente. Sin esto, cada
  /// sincronización duplicaría el maestro entero.
  @@unique([organizationId, connectorId, kind, externalId])
  @@index([organizationId, kind])
}

/// Un hecho con fecha. Append-only: nada se actualiza, nada se borra.
model BusinessEvent {
  id             String   @id @default(cuid())
  organizationId String
  connectorId    String
  kind           BusinessEventKind
  externalId     String
  occurredAt     DateTime            // cuándo pasó EN EL NEGOCIO
  recordedAt     DateTime @default(now())  // cuándo nos enteramos

  // Promovidas a columna porque son sobre las que se hacen cuentas.
  amountCents    Int?
  currency       String?
  quantity       Decimal?

  subjectId      String?             // a qué BusinessEntity se refiere
  correlationId  String?             // qué hechos son el mismo pedido
  attributes     Json     @default("{}")

  /// La garantía de idempotencia. Un webhook reenviado, un reintento o un solape de
  /// ventanas de polling no pueden duplicar una venta: aquí eso sería facturación
  /// inventada.
  @@unique([organizationId, connectorId, kind, externalId])
  @@index([organizationId, kind, occurredAt])
  @@index([organizationId, correlationId])
}
```

**Por qué un registro de hechos y no tablas por concepto:**

1. Es **append-only**, que es la misma disciplina que ya gobierna `ConfidenceEvent`,
   `AuditLog` y el historial de creencias. Coherente con lo que el producto ya es.
2. Una comanda no es una tabla: es `ORDER_PLACED` → `ORDER_SENT_TO_KITCHEN` →
   `ORDER_ITEM_READY` → `ORDER_CLOSED`, unidos por `correlationId`. Todas las métricas de
   cocina son restas entre dos filas.
3. Un proveedor que no emita uno de esos hechos simplemente no escribe esa fila. **La ausencia
   es visible**, en vez de ser un `NULL` en una columna que alguien acabará rellenando a ojo.
4. Añadir Shopify no añade tablas: añade valores al enum.

**Lo que cuesta:** `attributes` es JSON y no se consulta con la misma comodidad. Se acepta a
cambio de que las cuatro columnas sobre las que se hacen cuentas —`occurredAt`, `amountCents`,
`quantity`, `kind`— sí sean columnas de verdad, con índice.

### D.3 Qué pertenece a qué capa

| Concepto | Capa | Razón |
|---|---|---|
| `Insight`, `Recommendation`, `BusinessObjective` | **Core** | Ya existen. Son el producto |
| `BusinessEntity`, `BusinessEvent` | **Dominio de datos de negocio** | Comunes a todos los conectores, ajenos a cualquiera |
| `OrganizationConnector`, `Integration`, `ConnectorSync` | **Dominio de integración** | Ciclo de vida de la conexión |
| Comanda, mesa, camarero, cuenta, escandallo | **Solo el conector** | Vocabulario de un sector. Entra normalizado o no entra |
| Huella, encadenamiento, XML de la AEAT | **Solo el conector** | Ver sección E |

### D.4 Cambios sobre lo que ya existe

Mínimos y no destructivos:

1. **`Integration`**: añadir `connectorKey String`, `authKind` (`OAUTH2 | API_KEY | BASIC |
   CERTIFICATE`), `secretEnc String?` genérico y `revokedAt DateTime?`. Los campos actuales se
   mantienen para no romper Google.
2. **`IntegrationProvider`**: dejar de usarlo como discriminador y pasar a `connectorKey` de
   texto. El enum se conserva mientras haya filas que lo usen.
3. **`KnowledgeSource`**: **no se toca.** Es de la otra vía.

---

## E. Veri\*factu — viabilidad, requisitos y riesgos

### E.1 Qué exige la norma, con fechas vigentes

El Real Decreto 1007/2023 (RRSIF) y la Orden HAC/1177/2024 regulan los **sistemas informáticos
de facturación (SIF)**: los que un empresario usa para **registrar operaciones de venta y
emitir facturas o tickets**.

Fechas tras el Real Decreto-ley 15/2025, que aplazó un año la entrada en vigor:

| Obligado | Desde |
|---|---|
| Contribuyentes del Impuesto sobre Sociedades | **1 de enero de 2027** |
| Autónomos y resto | **1 de julio de 2027** |

Estamos a **cuatro meses** de la primera fecha. No es un tema de futuro.

Requisitos técnicos de un SIF: registro de alta por cada factura desde el segundo 0,00; registro
de anulación; inalterabilidad; **huella y encadenamiento** de registros —cadena única por
obligado, con independencia de las series—; registro de eventos; QR tributario en la factura; y
capacidad de exportar y remitir. En modalidad Veri\*factu la remisión es **inmediata y
continua**, no se exige firma electrónica del registro, y **la AEAT asume la conservación**.

Si falla el envío: se reintenta hasta obtener confirmación, marcando el intento como
*incidencia*. **La facturación no se detiene.**

### E.2 Las tres cosas que BusinessBrain podría ser

**Escenario 1 — Lector. 🟢 VERDE.**

BusinessBrain lee registros de facturación **ya emitidos** por el SIF del cliente y no
participa en su emisión.

La propia AEAT lo resuelve: los sistemas que tratan registros de facturación **pero no emiten
facturas quedan fuera del ámbito del reglamento**, salvo que funcionen como componente
integrado de la generación de la factura.

Requisitos: ninguno derivado del RRSIF. Los de siempre —RGPD, cifrado, aislamiento— que ya
tenemos.

**Escenario 2 — Remitente por cuenta del cliente. 🟡 AMARILLO.**

El cliente emite con su SIF; BusinessBrain remite los registros a la AEAT en su nombre.

Es **legalmente posible**: se admite representación, apoderamiento y colaboración social, con
certificado cualificado del tercero, y un proveedor de software puede remitir por cuenta de
varios clientes siempre que **cada envío contenga registros de un solo obligado**.

Condiciones que lo hacen caro:

- Custodia de un **certificado cualificado** por cliente o un convenio de colaboración social.
  Eso es material sensible de otra categoría que un token de OAuth: no caduca solo, no se
  revoca desde una pantalla de Google, y su uso indebido tiene consecuencias fiscales.
- Alta disponibilidad real. La remisión es inmediata. Si estamos caídos, el cliente acumula
  incidencias en su facturación por culpa nuestra.
- Nos coloca peligrosamente cerca de «componente integrado del proceso de emisión», que es la
  frontera exacta que nos metería en el escenario 3.

**Escenario 3 — Emisor o generador de la cadena. 🔴 ROJO.**

Si BusinessBrain construye el registro de alta, calcula la huella o mantiene el encadenamiento,
**es un SIF**. Con todo lo que eso arrastra: documento de cumplimiento / declaración
responsable, inalterabilidad demostrable, registro de eventos, y el régimen sancionador del
artículo 201 bis de la LGT.

Los importes (a confirmar con asesoría fiscal antes de cualquier decisión):

| Quién | Importe |
|---|---|
| Quien **tiene o usa** software no conforme | **50.000 € por ejercicio** |
| Quien **produce o comercializa** software no conforme | **150.000 € por ejercicio y tipo de software** |

Somos productores. La sanción que nos aplicaría es la grande, es fija, y es acumulable por
ejercicios.

### E.3 Veredicto — y una recomendación que probablemente no esperas

**🟡 AMARILLO como conector de lectura de facturación. 🔴 ROJO como cualquier forma de emisión
o encadenamiento.**

Pero antes de eso, la pregunta de la regla de oro: **¿qué decisión empresarial nueva permite
tomar?** Cosas reales: márgenes que se erosionan cliente a cliente, concentración excesiva en
un cliente, retrasos de cobro que anticipan un impago, estacionalidad.

Todo eso es valioso. **Y para todo eso, la AEAT es la peor fuente posible:** llega tarde, llega
en formato fiscal, y llegar hasta ella nos mete en un reglamento con sanciones de seis cifras.

Los mismos datos —con más contexto: cliente, concepto, vencimiento, estado de cobro— están en
el programa de facturación que el cliente ya usa. Holded, Sage, FacturaDirecta, Quipu, Contasimple.
Con API documentada, sin certificado que custodiar y sin reglamento que cumplir.

> **Recomendación: la integración no es Veri\*factu. Es el software de facturación del cliente.**
> Con el mismo valor de negocio, sin exposición sancionadora y con menos trabajo.

Veri\*factu vuelve a la mesa el día que un cliente pida expresamente que remitamos por él —y
ese día se decide con asesoría fiscal delante, no con esta arquitectura.

### E.4 Si aun así se decide entrar

Condiciones mínimas, no negociables:

1. Informe de asesoría fiscal **por escrito** confirmando que la figura elegida no nos hace SIF.
2. Aislamiento absoluto: `connectors/verifactu/`, sin que una sola línea del core lo conozca.
3. Nunca calcular huella ni mantener encadenamiento.
4. Entorno de pruebas de la AEAT superado antes de cualquier cliente real.
5. Registro íntegro e inalterable de cada envío, respuesta e incidencia.
6. Un fallo nuestro **jamás** puede detener la facturación del cliente.

---

## F. Restaurante — TPV, comandas y cocina

### F.1 Qué datos hacen falta de verdad

| Dato | Falta hace | Sin él |
|---|---|---|
| `order.externalId` + `occurredAt` de apertura | **Imprescindible** | No hay nada |
| Hora de **envío a cocina** | **Imprescindible** para tiempos de preparación | Solo se puede medir el servicio total, no la cocina |
| Hora de **plato/comanda listo** | **Imprescindible** para tiempos | Ídem |
| Hora de cierre / cobro | Imprescindible | No se puede medir el ciclo completo |
| Líneas: producto, cantidad, importe | Imprescindible | No hay análisis por producto |
| Local (si hay varios) | Muy recomendable | No se pueden comparar locales |
| Comensales por mesa | Recomendable | No hay ticket medio por comensal |
| Estación de cocina | Opcional | No se puede localizar el cuello de botella |
| Camarero | Opcional — **y delicado** | Ver F.4 |

### F.2 Qué dan realmente los TPV

Y aquí está el hallazgo incómodo:

- **Sistemas internacionales (Toast, Square, Lightspeed):** API documentada y portal de
  desarrollador público. Toast expone el ciclo de vida completo de la comanda con webhook de
  cambio de estado de preparación y marcas de tiempo de creación, actualización, completado y
  cobro. **Encajan.**
- **TPV españoles de hostelería (Glop, Camarero10, Ágora, Revo, Hosteltáctil):** dominan el
  mercado al que apuntamos y **no publican API abierta**. Glop menciona «una API opcional».
  Camarero10 tiene módulo de cocina. Pero no hay portal de desarrollador ni documentación
  pública que permita empezar sin hablar con ellos.

**Consecuencia:** con los TPV españoles, el primer obstáculo **no es técnico, es comercial**.
Hace falta un acuerdo de integración con cada fabricante. Eso no se resuelve programando.

### F.3 Cómo degradar sin mentir

La regla: **`capabilities` manda.**

| Lo que da el TPV | Lo que BusinessBrain enseña |
|---|---|
| Ciclo completo con marcas intermedias | Tiempos de cocina por franja, día, producto y estación |
| Solo apertura y cierre | **Tiempo de servicio total**, dicho como tal. La pantalla de cocina no existe |
| Solo tickets cerrados, sin horas intermedias | Ventas, ticket medio, producto, franja. Nada de tiempos |
| Volcado nocturno | Todo lo anterior **con un día de retraso, y dicho en la pantalla** |

Nunca se estima un dato que no llega. Es la regla que ya aplica el narrador: cuando falta el
hecho, se calla.

### F.4 Un aviso que conviene dar antes de venderlo

Medir tiempos por camarero es técnicamente trivial y **laboralmente delicado**. Convierte una
herramienta de negocio en una de control individual, con implicaciones de RGPD y de convenio.

Recomendación: **por defecto, agregado por local y franja, nunca por persona.** Si un cliente lo
pide, que sea una decisión suya, explícita y registrada.

### F.5 Veredicto

**🟢 VERDE técnicamente, 🟡 AMARILLO comercialmente.** Es el mejor caso de valor de toda la
Fase 9 —hay una cadena completa de datos a acción— y es el que depende de una conversación con
un fabricante antes que de una línea de código.

---

## G. Ejemplos de valor real

Cómo se leería un hallazgo de TPV, con la misma jerarquía que ya usa el producto:

> **Los sábados por la noche los platos tardan casi la mitad más en salir.**
>
> **Qué hemos detectado.** Entre las 21:00 y las 22:30 de los sábados, el tiempo medio desde
> que la comanda entra en cocina hasta que el plato sale es de 24 minutos. El resto de la
> semana, en esa misma franja, son 17.
>
> **Por qué importa.** Coincide con la franja de mayor volumen de comandas de la semana.
>
> **Qué hacer.** Revisar la capacidad de cocina en esa franja.
>
> *Ver el detalle técnico → 6 sábados · 412 comandas · mediana 23 min · p90 41 min · fuente:
> TPV, marcas de envío a cocina y de plato listo.*

Nótese el «**coincide con**». No «la causa es». Tenemos dos series que se mueven juntas; no
tenemos un experimento. La misma disciplina que hoy separa un hecho de un juicio en
`insight-narrative.ts`.

Otros hallazgos que la cadena permitiría, cada uno con su decisión detrás:

| Hallazgo | Decisión que habilita |
|---|---|
| Un producto tarda el triple que la media de su carta | Rediseñar el plato o su preparación |
| Los jueves sobra personal en cocina y los sábados falta | Redistribuir el cuadrante |
| El ticket medio cae los días de mayor volumen | Revisar sugerencia de venta bajo presión |
| Un cliente pasó del 8 % al 31 % de la facturación | Riesgo de concentración |
| Un cliente estira el pago de 30 a 55 días | Anticipar tensión de tesorería |

Y el que da sentido a las dos vías juntas, que ninguna herramienta actual del cliente puede dar:

> «La política de descuentos fija un máximo del 15 % para mayoristas *(documento)*. En los
> últimos dos meses, 34 pedidos de ese canal han salido por encima *(hechos del TPV)*.»

Eso es el producto: **el documento dice la norma, los hechos dicen la realidad, y BusinessBrain
es el único que ve las dos cosas a la vez.**

---

## H. Seguridad

### H.1 Lo que ya está resuelto

AES-256-GCM con clave validada de 32 bytes. `PUBLIC_SELECT` que jamás incluye tokens. Refresco
con margen. Detección de revocación aguas arriba. Desconexión que revoca en el proveedor aunque
falle. Auditoría con redacción. Todo eso se hereda.

### H.2 Lo que hay que añadir

| Medida | Por qué |
|---|---|
| **`secretEnc` genérico + `authKind`** | Hoy solo caben tokens de OAuth |
| **Clave derivada por organización** (HKDF de la maestra + `organizationId`) | Hoy una sola clave descifra los secretos de todos los clientes. Derivar hace que confundir organizaciones sea imposible por construcción, no por cuidado |
| **Nada de secretos en `attributes`** | Es JSON libre y acabaría en un informe. Prueba estructural |
| **Verificación de firma en todo webhook + ventana anti-reenvío** | Un endpoint público sin firma es una vía de inyección de datos falsos |
| **`PLATFORM_SELECT` explícito** | Ver H.3 |
| **Rotación y caducidad de secretos** | Hoy no hay ni una ni otra |

### H.3 El administrador de plataforma

Requisito: **puede gestionar el estado de una integración sin acceder al secreto.**

Hoy se cumple por omisión —la plataforma no sabe que existen las integraciones—, lo cual es
seguro pero inútil: no puede diagnosticar la avería de un cliente.

Propuesta, alineada con `PlatformAccessGrant`:

| Ve | Alcance | Sin concesión |
|---|---|---|
| Qué conectores hay, estado, última sincronización, código de error | `METADATA` | ✅ Sí |
| Histórico de intentos, latencias, tasa de fallo | `DIAGNOSTICS` | ❌ Requiere concesión |
| Contenido de un hecho concreto | `CONTENT` | ❌ Requiere concesión y reautenticación |
| **El secreto, en cualquier forma** | — | **❌ Nunca. No hay concesión que lo permita** |

La última fila debe ser **estructural**: `secretEnc` no aparece en ninguna proyección de
plataforma, y una prueba lo comprueba. Igual que hoy se comprueba que la superficie de cliente
no devuelve tokens.

### H.4 Desconexión y borrado

- **Desconectar**: revocar aguas arriba, borrar el secreto, marcar `revokedAt`, dejar de
  sincronizar. **Los hechos ya recibidos se conservan.** Son historia de la empresa, no del
  proveedor: borrarlos por cambiar de TPV destruiría la serie temporal que da todo el valor.
- **Borrar de verdad**: a petición explícita, y borra también las conclusiones cuya única
  evidencia eran esos hechos. Una conclusión sin evidencia es una afirmación sin respaldo.
- Ambas cosas, auditadas.

---

## I. Costes

### I.1 El coste que importa no es la API

| Concepto | Orden de magnitud mensual por cliente |
|---|---|
| API del proveedor (TPV, Stripe, facturación) | **0 €** — casi todas son gratuitas para el titular de los datos |
| Almacenamiento de hechos (2.000/día ≈ 60.000/mes) | **céntimos** |
| Cómputo de sincronización | **céntimos** |
| **Análisis con modelo de lenguaje** | **de 0 € a 300 €, según cómo se diseñe** |

Todo el riesgo de rentabilidad está en la última fila, y es una decisión de arquitectura.

### I.2 La regla que mantiene esto rentable

> **Los hechos operativos se analizan con aritmética. El modelo de lenguaje no ve el flujo de
> eventos.**

Un ejemplo con números. 2.000 tickets diarios:

| Diseño | Llamadas/mes | Coste aproximado |
|---|---|---|
| Un *embedding* por ticket | 60.000 | 30–90 € |
| Un análisis con modelo por ticket | 60.000 | **600–3.000 €** ❌ |
| **Métricas con SQL + narrador determinista** | **0** | **0 €** ✅ |
| Métricas con SQL + redacción con modelo de los hallazgos | ~50 | < 1 € |

Y esto no es una aspiración: **`narrarConclusion()` ya escribe las cuatro frases de una
conclusión sin llamar a ningún modelo.** La arquitectura rentable es la que ya está construida;
lo único que hay que hacer es no romperla metiendo tickets por la vía del documento.

Un cliente de restauración cuesta, en infraestructura, **céntimos al mes**. Con un solo error de
diseño, cientos de euros.

### I.3 Sincronización

| Vía | Cuándo | Coste |
|---|---|---|
| **Webhook** | Preferente siempre que exista | El más barato: llega solo lo que cambia |
| **Sondeo incremental** con `syncCursor` | Cuando no hay webhook | ~96 llamadas/día a 15 min |
| **Sondeo completo** | Nunca en régimen | Solo en la carga inicial |
| **Volcado nocturno** | TPV sin API | Barato, pero un día de retraso — y hay que decirlo |

Topes por organización desde el primer día, medidos en `UsageRecord`, que ya existe y ya
soporta topes: eventos por día, sincronizaciones por hora, tamaño de lote. Sin ellos, un TPV
mal configurado en bucle sale de nuestro bolsillo.

### I.4 El riesgo de coste que no es económico

Cada conector es **mantenimiento perpetuo**: las APIs cambian, los tokens caducan, los
proveedores rompen contratos sin avisar. Un conector no cuesta lo que cuesta escribirlo; cuesta
lo que cuesta tenerlo vivo tres años.

**Recomendación: menos conectores y mejores.** Tres que funcionen impecablemente valen más que
diez a medias, tanto para el cliente como para nosotros.

---

## J. UX de las integraciones

Tu propuesta es correcta. Añado cuatro cosas.

**1. Cada integración se explica en negocio, con lo que *no* puede hacer.**

```
FACTURACIÓN

  Tu programa de facturación                       ○ No conectado

  Qué hace          BusinessBrain lee tus facturas emitidas para
                    entender márgenes, clientes y cobros.
  Qué usará         Facturas emitidas: fecha, importe, cliente,
                    concepto y vencimiento.
  Qué NO hará       No emite facturas. No las modifica. No las
                    envía a Hacienda. Solo lee.
  Qué necesitas     Tu usuario del programa de facturación.

                                              [ Conectar ]
```

El apartado «**Qué NO hará**» no es letra pequeña: es lo que permite que alguien conecte su
facturación sin miedo. Y en el caso de Veri\*factu es, además, la frontera legal.

**2. Estado en lenguaje de persona.**

| Estado | Lo que se lee |
|---|---|
| Conectado y al día | «Conectado · última lectura hace 12 minutos» |
| Sin datos nuevos | «Conectado · sin novedades desde ayer» |
| Con problema | «Ha dejado de leer. El programa pide volver a autorizar.» + **[Volver a conectar]** |
| Nunca conectado | «No conectado» |

Un error nunca se enseña como código. La pantalla dice qué ha pasado y qué hacer, igual que
hace hoy una conclusión.

**3. La pantalla dice lo que esa conexión concreta permite.**

Si el TPV no da horas de cocina: «Con este TPV podrás ver ventas, ticket medio y productos. **No
podrás ver tiempos de cocina**: tu TPV no envía esa información.» Antes de conectar, no después.

**4. Componentes.** Todos los que nombras existen en `apps/web/src/ui/primitives.tsx` y
`ui/states.tsx`: `PageHeader`, `Section`, `Card`, `Metric`, `StatusPill`, `Button`,
`EmptyState`, `DataState`. **Salvo `Field`**, que hoy es local a `RecommendationsPage.tsx`: si
se va a usar en integraciones, hay que promoverlo a primitiva primero. Nada de un sistema nuevo.

**Dónde vive:** Configuración → Integraciones. No en la navegación principal: conectar es algo
que se hace una vez, no un sitio donde se trabaja. Lo que sí aparece en el flujo diario es el
resultado, en Análisis y en Comprensión, exactamente igual que hoy.

---

## K. Pruebas necesarias

Antes de escribir el primer conector. Ninguna sustituye a las que ya hay.

**Aislamiento (las innegociables)**
- Ninguna consulta de hechos sin `organizationId`; prueba estructural.
- La organización A no ve un `BusinessEvent` de B, ni por id directo.
- Un secreto de A jamás se descifra en el contexto de B.
- Un webhook con datos de A dirigido al conector de B se rechaza.

**Credenciales**
- El secreto no aparece en ninguna respuesta HTTP, ni de cliente ni de plataforma.
- No aparece en logs, ni en `AuditLog`, ni en un mensaje de error.
- Desconectar borra el secreto y revoca aguas arriba.
- Revocación externa → estado `ERROR`, y deja de reintentar.

**Sincronización e idempotencia**
- El mismo hecho entregado dos veces produce **una fila**.
- Un webhook reenviado no duplica.
- Dos ventanas de sondeo solapadas no duplican.
- Un lote a medias no deja hechos huérfanos.
- El marcador solo avanza cuando el lote se ha persistido.

**Errores y límites**
- El proveedor caído no rompe la sincronización de los demás.
- Reintento con espera creciente y tope.
- Superar el tope de eventos detiene la ingesta y lo dice.
- Un webhook sin firma válida se rechaza sin tocar la base.

**Capacidades y honestidad**
- Una métrica sin su dato de entrada **no se calcula ni se muestra**.
- Un conector que no declara una capacidad no la ofrece en la API.

**Permisos y plataforma**
- Conectar y desconectar exigen `ADMIN` o superior.
- La plataforma ve estado sin concesión, diagnóstico con `DIAGNOSTICS`, y **el secreto nunca**.
- Desconectar exige reautenticación reciente.

---

## L. Roadmap

### L.1 Validación del orden que propones

| Fase propuesta | Veredicto | Cambio |
|---|---|---|
| 9A Connector Core | ✅ | Añadir antes la **cola durable**. Sin ella, 9D y 9E no se sostienen |
| 9B Credenciales | ⚠️ | Ya existe el 70 %. Es **generalizar**, no construir. Fusionar con 9A |
| 9C Primer conector sencillo | ✅ **Sí, y es el más importante** | Que sea **el software de facturación**, no un juguete |
| 9D Veri\*factu | ❌ **Sacar del roadmap** | Sustituido por 9C. Vuelve solo si un cliente lo pide, con asesoría fiscal |
| 9E TPV | ✅ | Adelantar el trabajo **comercial** ya: bloquea antes que el técnico |
| 9F WhatsApp | ⚠️ **Bajar de prioridad** | Ver L.3 |
| 9G Otros | ✅ | Sin cambios |

### L.2 Orden recomendado

| Fase | Qué | Por qué ahí |
|---|---|---|
| **9A** | Cola durable + `BusinessConnectorPort` + `BusinessEntity`/`BusinessEvent` + registro + capacidades + generalización de `Integration` | Todo lo demás se apoya aquí |
| **9B** | Superficie de webhooks: firma, anti-reenvío, idempotencia, topes | Es la puerta de entrada. Debe estar bien antes de abrirla |
| **9C** | **Conector de facturación** (un solo proveedor, con API pública) | Prueba la arquitectura entera con valor real y **sin exposición regulatoria** |
| **9D** | Estrategia de señales operativas + `BusinessSignalsPort` + entradas del narrador | Convierte datos en conclusiones. **Sin esto, 9C solo importa datos** — y eso, por tu propia regla de oro, no es producto |
| **9E** | Pantalla de Integraciones | Cuando ya hay dos conectores que enseñar |
| **9F** | TPV — *el acuerdo comercial empieza hoy, en paralelo* | Máximo valor, máxima dependencia externa |
| **9G** | Stripe / Shopify | Encajan sin fricción en lo construido |
| **9H** | WhatsApp | Ver abajo |

**9D es la fase que no puede saltarse.** Es tentador dejarla para después de tener tres
conectores: sería el error clásico de acabar con un importador de datos en vez de un cerebro.

### L.3 WhatsApp — la única que no pasa tu regla de oro

*«¿Qué decisión empresarial nueva permite tomar?»*

Como **fuente**: conversaciones de clientes. Valor real —reclamaciones repetidas, dudas
frecuentes— pero con una carga de datos personales muy superior a la de cualquier otra
integración, sin consentimiento del interlocutor, y con la API de Meta como intermediario de
pago por conversación.

Como **canal de salida** (que BusinessBrain avise por WhatsApp): eso es una notificación, no una
integración de datos. Es útil, es barato y no encaja en esta arquitectura.

**Recomendación: separarlas.** El canal de salida, cuando toque, como notificación. La lectura
de conversaciones, la última de la lista y solo si un cliente la pide.

---

## M. Decisiones que necesitan tu aprobación

Ninguna se ha tomado. Aquí están, con mi recomendación:

| # | Decisión | Mi recomendación |
|---|---|---|
| 1 | **¿Dos vías separadas (documentos / hechos) o una sola?** | **Dos.** Es la decisión estructural de la fase. Meter tickets por la vía del documento haría el producto lento, caro y poco fiable |
| 2 | **¿Registro de hechos o tablas por concepto?** | **Registro de hechos.** Dos tablas cubren los trece conceptos sin construir un ERP |
| 3 | **¿Veri\*factu sí o no?** | **No ahora.** Conectar el software de facturación del cliente: mismo valor, cero exposición sancionadora |
| 4 | **¿Cola durable ya?** | **Sí, en 9A.** Sin ella no hay webhooks fiables ni reintentos |
| 5 | **¿Clave de cifrado derivada por organización?** | **Sí.** Es barato ahora y caro después |
| 6 | **¿La plataforma ve el estado de las integraciones?** | **Sí, solo metadatos.** El secreto, nunca, y comprobado con prueba estructural |
| 7 | **¿Se empieza ya la conversación comercial con un TPV?** | **Sí.** Es el plazo más largo de todo el roadmap |
| 8 | **¿Modelo de negocio?** | Ver N |
| 9 | **¿Se toca el modelo de datos?** | **Todavía no.** Nada de esto se implementa sin tu visto bueno |

---

## N. Modelo de negocio

Sin cifras: solo las formas y lo que provoca cada una.

| Forma | Qué implica | Riesgo |
|---|---|---|
| **Todo incluido** | Simple de vender y de entender | Un cliente con 3.000 tickets/día cuesta lo mismo que uno con 30. Con la arquitectura de I.2 el coste es bajo, así que el riesgo es **soportable** |
| **Por plan** | Básicas incluidas; TPV y facturación en plan superior | Coherente con `PlanTier`, que ya existe. **La más razonable** |
| **Complemento** | Cada integración se paga aparte | Justifica el mantenimiento de cada conector, pero convierte la venta en un catálogo |
| **Por consumo** | Se paga por volumen de hechos | Justo, e **imposible de explicar a una PYME**. Nadie sabe cuántos eventos genera su TPV |

**Recomendación: por plan, con una excepción.** Las integraciones que exijan trabajo por cliente
—un TPV con acuerdo particular, o cualquier día Veri\*factu— van como complemento, porque su
coste no es de servidor sino de personas.

Y un aviso: con el diseño de I.2 el coste marginal es de céntimos. **El precio debe fijarse por
el valor de la decisión que habilita, no por el coste.** Ver que los sábados se pierde media
hora de cocina vale mucho más de lo que cuesta calcularlo.

---

## O. Conclusión

BusinessBrain está mejor preparado para esto de lo que parecía antes de auditarlo. Existe un
sistema de conectores con cuatro implementaciones, custodia de credenciales seria y un motor de
comprensión que consume *hechos* y ya sabe explicarlos en lenguaje de negocio sin gastar un
céntimo en modelos.

Lo que falta no es cantidad de código: es **una decisión de arquitectura**. Los documentos
entran por semejanza; los hechos tienen que entrar por aritmética. Confundir las dos vías es el
único error de esta fase que sería caro de deshacer, y es exactamente el que se comete por
inercia, porque el conector de documentos ya existe y «casi» vale.

Sobre las dos integraciones que planteabas: la del restaurante es la buena —hay una cadena
completa de datos a decisión— y su obstáculo es una conversación con un fabricante, no un
problema de ingeniería. La de Veri\*factu, en cambio, es un caso donde el camino evidente y el
correcto no coinciden: se puede hacer, pero el mismo valor está a un paso de distancia, en el
programa de facturación que el cliente ya usa, sin certificados que custodiar y sin un
reglamento con sanciones de seis cifras.

No se ha implementado nada. Nada se implementará hasta que decidas los nueve puntos de la
sección M.
