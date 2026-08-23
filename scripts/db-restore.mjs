#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { parseDatabaseUrl, pgCommand, run } from './pg.mjs';

/**
 * Restaura una copia en una base de datos NUEVA.
 *
 * Uso:  node scripts/db-restore.mjs copia.dump nombre_de_la_base
 *
 * ## Por qué exige un nombre de base y nunca sobrescribe
 *
 * Restaurar encima de la base que está en producción es la operación que convierte un susto en
 * un desastre: si la copia está incompleta o es más vieja de lo que se creía, ya no hay a qué
 * volver. Se restaura AL LADO, se comprueba, y solo entonces alguien decide.
 *
 * Y por eso el ensayo de recuperación —que es lo único que convierte un fichero en una copia de
 * seguridad— se puede hacer cualquier martes sin arriesgar nada.
 */

const url = process.env.DATABASE_URL;
const [ficheroArg, nombreBase] = process.argv.slice(2);

if (!url || !ficheroArg || !nombreBase) {
  console.error(
    'Uso: node --env-file=apps/backend/.env scripts/db-restore.mjs <copia.dump> <base_destino>',
  );
  process.exit(1);
}

// Un nombre con comillas o espacios entraría en la orden SQL de abajo. Se estrecha en vez de
// escapar: una base de datos de restauración no necesita llamarse de forma exótica.
if (!/^[a-z_][a-z0-9_]*$/.test(nombreBase)) {
  console.error(
    'El nombre de la base solo puede llevar minúsculas, números y guiones bajos.',
  );
  process.exit(1);
}

const conexion = parseDatabaseUrl(url);
const fichero = resolve(ficheroArg);

// `postgres` es la base administrativa: no se puede crear una base estando conectado a ella
// misma, y esta siempre existe.
const admin = { ...conexion, database: 'postgres' };

await run(
  await pgCommand(
    'psql',
    ['--dbname', 'postgres', '--command', `DROP DATABASE IF EXISTS ${nombreBase}`],
    admin,
  ),
);
await run(
  await pgCommand(
    'psql',
    ['--dbname', 'postgres', '--command', `CREATE DATABASE ${nombreBase}`],
    admin,
  ),
);

await run(
  await pgCommand(
    'pg_restore',
    ['--no-owner', '--no-privileges', '--dbname', nombreBase],
    conexion,
  ),
  { stdin: createReadStream(fichero) },
);

console.log(
  `Copia restaurada en la base "${nombreBase}". Compruébala antes de sustituir nada.`,
);
