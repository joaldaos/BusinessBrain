# Copia de seguridad y restauración

## Por qué este documento existe

"Tenemos copias de seguridad" y "sabemos que restauran" son afirmaciones distintas, y la
primera no implica la segunda.

Los desastres de datos casi nunca son por no tener copia. Son por descubrir el día malo que la
copia estaba incompleta, que nadie sabía el procedimiento, o que el procedimiento no funcionaba
en esa máquina. Por eso aquí no hay solo una orden que ejecutar: hay un **ensayo automatizado**
que hace el ciclo entero y comprueba que los datos vuelven.

Una PYME que confía sus contratos a BusinessBrain está confiando exactamente esto.

---

## Hacer una copia

```bash
node --env-file=apps/backend/.env scripts/db-backup.mjs
```

Escribe en `backups/businessbrain-<fecha>.dump`. Se le puede pasar otra ruta como argumento.

El formato es el personalizado de Postgres (`-Fc`), no SQL plano: se puede restaurar entero o
por partes, y en paralelo. El día que haya que recuperar **una** tabla porque alguien borró lo
que no debía, la diferencia es entre unos minutos y levantar una base entera al lado.

El script usa `pg_dump` si está instalado y, si no, el que ya vive dentro del contenedor de
Postgres. Un procedimiento que solo funciona en una de las dos máquinas es un procedimiento que
nadie practica.

## Restaurar

```bash
node --env-file=apps/backend/.env scripts/db-restore.mjs backups/<fichero>.dump businessbrain_restaurada
```

**Restaura siempre en una base NUEVA, nunca encima de la que está en uso.** Restaurar sobre
producción convierte un susto en un desastre: si la copia está incompleta o es más vieja de lo
que se creía, ya no hay a qué volver. Se restaura al lado, se comprueba, y solo entonces alguien
decide cambiar el `DATABASE_URL`.

El script se niega a aceptar nombres de base con caracteres raros y borra la base de destino si
ya existía, para que un ensayo repetido no arrastre restos del anterior.

## Ensayar la recuperación

```bash
npm run test:ops --workspace @businessbrain/backend
```

Necesita Postgres en marcha (`docker compose up -d`).

El ensayo hace el ciclo completo, de verdad:

1. Crea una empresa con contenido real: documento con su texto, colección con su pertenencia,
   conclusión, recomendación pendiente, miembro propietario y configuración de fiabilidad.
2. Hace la copia y comprueba que el fichero no está vacío — el fallo clásico que solo se
   descubre al necesitarla.
3. **Borra la empresa.** No la oculta: la borra.
4. Restaura en `businessbrain_ensayo_restauracion`.
5. Comprueba una por una que han vuelto: la empresa **con su configuración**, el documento
   **con su contenido**, la colección **con su pertenencia**, la conclusión, la recomendación
   —y que sigue en estado pendiente, porque una restauración no puede aprobar nada— y la
   persona con su rol.

Si alguna vez este ensayo deja de pasar, la copia de seguridad ha dejado de servir. No es un
test de regresión más: es la única prueba de que el procedimiento funciona.

## Cada cuánto

Pendiente de decidir con el primer cliente: depende de cuánto conocimiento nuevo entra al día y
de cuánto está dispuesto a perder. Lo que **no** depende del cliente es que el ensayo se ejecute
antes de cada despliegue que toque el esquema.

## Lo que esto no cubre todavía

- **Automatización.** Hoy la copia se lanza a mano. Programarla es trabajo de despliegue, no de
  la aplicación, y depende de dónde se aloje.
- **Copias fuera de la máquina.** Un `.dump` en el mismo disco que la base no protege del fallo
  de ese disco. Llevarlo a otro sitio es, otra vez, decisión de despliegue.
- **Cifrado de la copia.** El fichero contiene los documentos de todos los clientes en claro.
  Quien lo guarde tiene que tratarlo como lo que es.
