#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDatabaseUrl, pgCommand, run } from './pg.mjs';

/**
 * Copia de seguridad de la base de datos.
 *
 * Uso:  node scripts/db-backup.mjs [destino.dump]
 *
 * ## Formato personalizado y no SQL plano
 *
 * `-Fc` produce un fichero comprimido que `pg_restore` puede restaurar entero o por partes,
 * y en paralelo. Un volcado en SQL plano solo se puede tragar de golpe: el día que haya que
 * recuperar UNA tabla porque alguien borró lo que no debía, la diferencia es entre minutos y
 * levantar una base entera al lado.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'Falta DATABASE_URL. Ejecuta desde la raíz con el entorno cargado, p. ej.:\n' +
      '  node --env-file=apps/backend/.env scripts/db-backup.mjs',
  );
  process.exit(1);
}

const conexion = parseDatabaseUrl(url);
const destino = resolve(
  process.argv[2] ??
    `backups/businessbrain-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`,
);

await mkdir(dirname(destino), { recursive: true });

const salida = createWriteStream(destino);
const orden = await pgCommand(
  'pg_dump',
  ['--format=custom', '--no-owner', '--no-privileges', '--dbname', conexion.database],
  conexion,
);

await run(orden, { stdout: salida });
await new Promise((listo) => salida.close(listo));

console.log(`Copia escrita en ${destino}`);
