# Fases 9A y 9B — lo que quedó construido

Qué hay, qué garantiza y qué deliberadamente no hace. Complementa
`FASE-9A-9B-ARQUITECTURA-CERRADA.md`, que es el diseño; esto es el resultado.

---

## Las dos vías de entrada

```
       LO QUE LA EMPRESA YA USA
   ┌──────────────┬──────────────────────┐
   │ Drive/Gmail  │  TPV · facturación   │
   └──────┬───────┴──────────┬───────────┘
          │                  │
   ConnectorPort      BusinessConnectorPort      ← dos contratos, no uno
   (documentos)            (hechos)
          │                  │
   KnowledgeItem      BusinessEntity           ← se trocea y vectoriza
   chunks · vectores  BusinessEvent            ← se agrega y se resta
          │                  │
          └────────┬─────────┘
                   ▼
            Insight  ·  InsightEvidence
         (KNOWLEDGE_ITEM … BUSINESS_METRIC)
                   ▼
      pantalla · recomendación · informe PDF
```

Los documentos entran por **semejanza**; los hechos, por **aritmética**. «¿Cuánto se tarda
los sábados?» es una media sobre una serie temporal, y un índice vectorial no la calcula: la
aproxima. Aproximar una media es inventarla.

Convergen en el `Insight`, que es lo único que ya sabe llevar evidencia, confianza, vigencia
y decisión humana.

---

## Qué garantiza, y dónde está comprobado

| Garantía | Cómo | Prueba |
|---|---|---|
| Dos procesos nunca ejecutan el mismo trabajo | `FOR UPDATE SKIP LOCKED` | `job-queue.int-spec` |
| Nada queda colgado tras una caída | Arrendamiento que vence | `job-queue.int-spec` |
| Encolar y escribir caben en una transacción | Cola en Postgres | `job-queue.int-spec` |
| El mismo hecho dos veces es una fila | Índice único por id externo | `business-facts.int-spec` |
| Un hecho no cuelga del cliente de otra empresa | Clave foránea compuesta | `business-facts.int-spec` |
| Un fallo no avanza el marcador | Transacción única | `connector-sync.int-spec` |
| Un envío sin firma válida no deja rastro | HMAC + ventana | `webhooks.int-spec` |
| Un reenvío capturado no sirve | Instante dentro de lo firmado | `webhook-signature.spec` |
| El secreto de una empresa no vale en otra | Clave derivada por ámbito | `encryption.util.spec` |
| Ningún secreto sale del backend | Barrido del código | `secrets-never-exposed.spec` |
| La plataforma diagnostica sin ver secretos | Proyección explícita | `plataforma-concesiones.e2e` |
| Una conclusión de hechos lleva evidencia | `BUSINESS_METRIC` + CHECK | `business-metric-evidence.int-spec` |
| Un bucle no llena la base | Techo diario | `connector-sync.int-spec` |

---

## Las decisiones que costaron más de una vuelta

### El cifrado por organización no podía cubrir el MFA

La decisión aprobada decía «por organización». El secreto de MFA es de un **usuario**: una
persona puede estar en varias organizaciones y el administrador de plataforma no está en
ninguna. Misma técnica (HKDF), distinto identificador.

Lo ya cifrado se lee gracias a que el formato lleva versión, y migra solo al reescribirse.
**Ninguna migración de datos.**

Esto rompió el harness de pruebas, que leía el secreto con la clave maestra. Lo detectó el
e2e, no yo.

### La cola, en Postgres

Redis estaba en `docker-compose` pero el backend nunca lo usó. Con la cola en la misma base,
encolar, escribir los hechos y cerrar el trabajo son **una transacción**; con la cola fuera
hay una ventana en la que un reinicio pierde o duplica. La idempotencia era el requisito.

### Un webhook no trae datos, trae un aviso

Lo que se encola es una sincronización que va a buscar la verdad al proveedor. Así el cuerpo
deja de ser una vía de escritura: aunque alguien tuviera el secreto, no podría inyectar una
venta.

### Pasarse del techo no es un fallo

Tratarlo como tal gastaría los reintentos de la cola en algo que solo se arregla esperando a
mañana, y acabaría enterrando el conector. De ahí `RunStatus.SKIPPED`: una ejecución omitida
no es un éxito ni un fallo, y meterla en cualquiera de los dos mentiría en la pantalla.

---

## Lo que NO existe todavía

- **Ningún conector concreto.** Ni TPV, ni facturación, ni WhatsApp, ni Veri\*factu.
- **La estrategia que convierte hechos en conclusiones.** Es 9D. Hay dónde guardar la
  métrica y cómo citarla como evidencia; no hay quién la calcule.
- **Pantalla de Integraciones.** Es 9E.
- **Recuperación de histórico.** El contrato la contempla (`backfill`); nadie la implementa.

---

## Estabilidad de las pruebas

Se corrigió una inestabilidad real en `gmail.int-spec`: el reloj de automatizaciones es el
único barrido que cruza organizaciones, así que lo que dejaban otros ficheros podía agotar su
cota de 25 por tic. Pasaba aislado y fallaba en la suite completa. Ahora neutraliza las
automatizaciones ajenas antes de medir la suya; suite completa verde tres veces seguidas.
