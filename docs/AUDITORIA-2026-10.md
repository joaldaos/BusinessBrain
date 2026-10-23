# Auditoría de BusinessBrain — octubre de 2026

Qué hay construido y probado, qué falta, qué puede hacer hoy el cerebro empresarial y qué
hace falta para una primera versión operativa en local.

Sobre `94a57a8`, rama `claude/sprint-c-fase-5-templates-5b709f`.

---

## 1. Lo que está terminado y probado

**1.030 pruebas unitarias · 494 de integración contra Postgres · 406 e2e HTTP en 29 suites.**
Más typecheck, lint sin errores, build y humo sobre `dist`. 126 rutas HTTP, 52 modelos, 34
migraciones.

| Área | Estado | Qué significa |
|---|---|---|
| Identidad, sesiones, MFA | ✅ Terminado | TOTP propio verificado contra los vectores del RFC, códigos de recuperación, reautenticación con ventana de 15 min |
| Multi-tenancy y permisos | ✅ Terminado | Dos ejes independientes: `PlatformRole` y `MembershipRole`. Ninguna consulta de datos cruza la frontera de una empresa |
| Conocimiento documental | ✅ Terminado | Subida, Drive, Gmail, web. Troceado, vectorizado, con linaje y fiabilidad que decae |
| Motor de comprensión | ✅ Terminado | Conclusiones con evidencia, confianza, vigencia, historial de creencia y curación humana |
| Recomendaciones | ✅ Terminado | Se proponen, se aceptan o descartan. **Nunca se ejecutan solas** |
| Objetivos empresariales | ✅ Terminado | Y son lo que convierte una anomalía en un riesgo |
| Informes PDF | ✅ Terminado | Compuestos al pedirlos, en lenguaje de negocio, con anexo técnico |
| Automatizaciones | ✅ Terminado | Reloj con reclamación condicional en Postgres |
| Plataforma y concesiones | ✅ Terminado | METADATA / DIAGNOSTICS / CONTENT, motivadas y con caducidad |
| Privacidad | ✅ Terminado | Exportación y borrado por organización |
| Interfaz | ✅ Terminado | 17 pantallas, sistema visual propio, castellano e inglés |
| **Cola durable** | ✅ **Nuevo (9A)** | Postgres, reparto concurrente, reintentos, recuperación tras caída |
| **Registro de hechos** | ✅ **Nuevo (9A)** | `BusinessEntity` + `BusinessEvent`, idempotencia estructural |
| **Contrato de conectores** | ✅ **Nuevo (9A)** | Con capacidades declaradas |
| **Cifrado por ámbito** | ✅ **Nuevo (9B)** | Clave derivada por organización y por usuario |
| **Webhooks firmados** | ✅ **Nuevo (9B)** | HMAC, ventana anti-reenvío, comparación en tiempo constante |
| **Techo diario de hechos** | ✅ **Nuevo (9B)** | Y la plataforma ya puede diagnosticar sin ver secretos |

---

## 2. Lo que está incompleto

| Falta | Impacto | Dónde |
|---|---|---|
| **Ningún conector de hechos** | El registro de hechos está vacío: nadie lo llena | 9C |
| **Ninguna estrategia sobre hechos** | Hay dónde guardar una métrica y cómo citarla; **no hay quién la calcule** | 9D |
| Pantalla de Integraciones | No se pueden conectar desde la interfaz | 9E |
| Recuperación de histórico | El contrato la contempla (`backfill`); nadie la implementa | 9C |
| Permisos por módulo | Hoy el rol es global en la empresa, no por área | Ver §4 |
| PDF solo en castellano | La interfaz es bilingüe; el informe no | — |
| WhatsApp, Veri\*factu | Decididos y aplazados | 9F+ |

**El hueco que más importa es 9D.** Sin él, la Fase 9 habría construido un importador de
datos — que por la propia regla de oro del producto no es producto.

---

## 3. Qué puede hacer hoy el cerebro empresarial

**Puede**: leer documentos de cuatro orígenes; responder preguntas citando de dónde sale cada
cosa y callarse cuando no hay material; detectar por su cuenta que un documento perdió
fiabilidad, que una fuente cayó o que dos documentos se contradicen; convertir eso en riesgo
**solo si hay un objetivo que lo justifique**; proponer qué hacer; registrar la decisión
humana; generar un informe entregable a una gestoría; y repetirlo solo cada semana.

**No puede todavía**: ver una sola venta, un ticket o una factura. Toda su comprensión viene
de documentos. La infraestructura para los hechos está construida y verificada, pero no hay
ningún conector que la alimente ni ninguna estrategia que los interprete.

Dicho en una frase: **entiende lo que la empresa ESCRIBE, no lo que la empresa HACE.**

---

## 4. Usuarios, roles y permisos

Dos ejes que no se tocan:

- **`PlatformRole`** (`USER` / `SUPERADMIN`): quién administra BusinessBrain. El
  administrador de plataforma **no pertenece a ninguna empresa** y la API de cliente le
  responde 403 igual que a un desconocido.
- **`MembershipRole`** (`VIEWER` < `MEMBER` < `ADMIN` < `OWNER`): qué puede hacer alguien
  dentro de SU empresa.

Se aplican en el backend, en los guards y en las consultas —no ocultando pantallas—, con
auditoría y concesiones revocables. El alcance de lectura se decide además por **colecciones
de conocimiento**: dos personas de la misma empresa pueden recibir informes distintos, y eso
es correcto.

**La diferencia con lo que quieres.** Tu visión pide permisos por módulo: administración,
contabilidad, atención al cliente, marketing. Hoy el rol es **global dentro de la empresa**:
un `MEMBER` lo es para todo. El alcance por colecciones cubre los *documentos*, no los
*módulos* ni las *acciones*.

No es un fallo, es alcance no construido. Y conviene decidirlo antes de 9D: si las
conclusiones van a venir también de ventas y cobros, «quién puede ver qué» deja de ser una
pregunta sobre documentos.

---

## 5. Qué falta para una primera versión operativa en local

Por orden, con lo que justifica cada estimación:

| # | Qué | Esfuerzo | Por qué ese tamaño |
|---|---|---|---|
| 1 | **Un conector de hechos real** (Square o Lightspeed) | 3–5 días | El contrato, la cola, la idempotencia y los secretos ya están. Es el cliente HTTP, la normalización y sus pruebas |
| 2 | **Estrategia de señales operativas** + cálculo de métricas | 5–8 días | Lo más valioso y lo más delicado: aquí es donde se decide qué se afirma y qué se calla |
| 3 | **Pantalla de Integraciones** | 2–3 días | Sistema visual hecho; es componer, con las capacidades declaradas visibles |
| 4 | **Permisos por módulo**, si se confirma §4 | 4–6 días | Toca guards, consultas y pruebas de aislamiento. No se improvisa |
| 5 | Demo con datos de TPV simulados | 1–2 días | Extender `scripts/demo.mjs` |

**Total: tres a cuatro semanas** para que BusinessBrain entienda hechos además de documentos,
en local y con datos simulados.

### Pruebas de aceptación

1. Conectado un TPV simulado, una comanda completa produce cuatro hechos correlacionados y la
   resta entre dos de ellos da el tiempo de preparación.
2. Con seis semanas de datos, el sistema detecta por su cuenta una desviación por franja y la
   presenta como **anomalía**; al confirmar un objetivo relacionado, la misma pasa a
   **riesgo**.
3. Esa conclusión cita una `BusinessMetricWindow` con su `sampleSize`, y con menos de N
   comandas **no se enseña**.
4. El PDF la cuenta en lenguaje de negocio, con el detalle en el anexo.
5. Reenviar el mismo webhook cien veces no cambia ningún recuento.
6. Un `MEMBER` sin alcance no ve la conclusión; la plataforma ve el estado del conector y
   nunca su secreto.

---

## 6. Qué se puede reutilizar de ONE

ONE es un SaaS Next.js que **observa** el correo de una empresa: conversaciones sin
responder, presupuestos sin cerrar, clientes enfriados. No envía, no modifica, no ejecuta.

| Pieza de ONE | ¿Reutilizable? | Por qué |
|---|---|---|
| **Modelo de WhatsApp** (`OrganizationWhatsAppConnection`, webhooks, conversaciones) | ✅ **Sí, el diseño** | Es lo único que BusinessBrain no tiene y ONE sí tiene resuelto: resolución de inquilino por `phoneNumberId` único en toda la base, token cifrado con versión de clave, código de error cerrado en vez de mensaje del proveedor. Tres decisiones acertadas |
| Versión de clave de cifrado (`tokenKeyVersion`) | ✅ **Sí, la idea** | BusinessBrain resolvió lo mismo con un prefijo `v2:` en el propio payload. Una columna es más explícita para rotar |
| `Finding` / `Evidence` | ⚠️ Solo como contraste | Equivale a `Insight`/`InsightEvidence`, que en BusinessBrain está mucho más desarrollado |
| Presupuesto de IA | ⚠️ No | BusinessBrain ya tiene el suyo y es más simple |
| Conexión de Gmail | ❌ No | BusinessBrain ya tiene su conector |
| Código, en general | ❌ No | Next.js con Prisma directo frente a NestJS con puertos y adaptadores. Trasplantarlo arrastraría la arquitectura equivocada |

**Conclusión:** lo reutilizable de ONE es **conocimiento de diseño, no código**, y se
concentra en WhatsApp. Cuando toque 9F, no se empieza de cero: se empieza del modelo de ONE.

Y hay una lección de producto: ONE declara que **observa y no ejecuta**. BusinessBrain dice lo
mismo de otra forma —«ninguna recomendación se ejecuta sola»—. Conviene que ambos lo sigan
diciendo igual el día que compartan cliente.

---

## 7. Riesgos y problemas técnicos

| Riesgo | Gravedad | Qué hacer |
|---|---|---|
| **`main` está en el scaffold de la Fase 1** | 🔴 Alta | Todo el producto —70+ commits— vive en una rama. Un borrado accidental de la rama perdería todo. **Decidir la fusión** |
| **Los e2e tardan ~5 min y en segundo plano fallan con 127** | 🟡 Media | Ejecutarlos por grupos en primer plano. Molesta, no bloquea |
| **Sin conector real, la arquitectura está probada contra simuladores** | 🟡 Media | Es exactamente por lo que 9C debe ser Square o Lightspeed: API pública, sin esperar a ningún acuerdo |
| **El TPV español no tiene API abierta** | 🟡 Media | Línea comercial, ya abierta. Meses de plazo |
| 12 avisos de lint preexistentes | 🟢 Baja | `any` en pruebas. Ruido |
| Sin cobertura medida | 🟢 Baja | Hay 1.930 pruebas; el número ayudaría a ver huecos |

### Lo que se arregló en esta fase y conviene no olvidar

- Dos contraseñas estaban escritas en Git (seed y script de demo).
- `Bash(node -e ' *)` estaba autorizado sin preguntar: ejecución de código arbitrario que
  anulaba cualquier regla de denegación.
- `gmail.int-spec` era inestable por interferencia entre ficheros. Tiene causa y está
  corregida.
- Dos pruebas de la restricción `CHECK` pasaban **por el motivo equivocado**: buscaban un
  documento que no existía y la base las rechazaba por venir sin referencia, no por traer dos.

---

## 8. Lo que necesita tu decisión

1. **¿Se fusiona la rama con `main`?** Es el riesgo más alto de la lista y no lo decido yo.
2. **¿Permisos por módulo antes o después de 9D?** Recomiendo **antes**: si las conclusiones
   van a venir de ventas y cobros, «quién ve qué» deja de ser una pregunta sobre documentos,
   y rehacerlo después toca guards, consultas y pruebas de aislamiento.
3. **¿9C es Square o Lightspeed?** Recomiendo empezar por cualquiera de los dos: API pública
   y autoservicio permiten validar la arquitectura **hoy**, sin esperar a ningún acuerdo.
