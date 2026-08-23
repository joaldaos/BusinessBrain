import { spawn } from 'node:child_process';

/**
 * Cómo se ejecutan las herramientas de Postgres.
 *
 * ## Por qué hay dos caminos y no uno
 *
 * En una máquina de desarrollo lo normal es NO tener `pg_dump` instalado: Postgres vive en un
 * contenedor. En un servidor lo normal es al revés. Un procedimiento de copia que solo funciona
 * en uno de los dos sitios es un procedimiento que nadie practica — y una copia que nunca se ha
 * restaurado no es una copia, es un fichero.
 *
 * Así que se busca el binario y, si no está, se usa el que ya vive dentro del contenedor. La
 * misma orden funciona en los dos sitios, que es lo único que hace que alguien la ejecute.
 *
 * ## Por qué se transmite por la entrada y salida estándar
 *
 * Con `docker compose exec`, un fichero escrito por `pg_dump` se quedaría DENTRO del
 * contenedor, en un disco que desaparece al recrearlo. La copia tiene que acabar en la máquina
 * de fuera, así que el volcado viaja por la salida estándar y se escribe aquí.
 */

/** Partes de la conexión, para poder recomponerla desde dentro del contenedor. */
export function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, ''),
  };
}

async function commandExists(command) {
  return new Promise((resolve) => {
    // Sin `shell`: el binario o está en el PATH o no está, y una shell intermedia solo añade
    // una capa donde los argumentos se concatenan sin escapar.
    const probe = spawn(command, ['--version'], { windowsHide: true });
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Prepara la ejecución de una herramienta de Postgres.
 *
 * Devuelve el programa y sus argumentos, ya sea directamente o a través del contenedor. La
 * contraseña viaja en `PGPASSWORD` y no en la línea de órdenes: los argumentos de un proceso
 * son visibles para cualquiera que liste los procesos de la máquina.
 */
export async function pgCommand(tool, args, connection) {
  if (await commandExists(tool)) {
    return {
      command: tool,
      args: [
        '--host', connection.host,
        '--port', connection.port,
        '--username', connection.user,
        ...args,
      ],
      env: { ...process.env, PGPASSWORD: connection.password },
    };
  }

  return {
    command: 'docker',
    args: [
      'compose', 'exec', '-T',
      '--env', `PGPASSWORD=${connection.password}`,
      'postgres',
      tool,
      // Dentro del contenedor, Postgres es el propio localhost.
      '--host', 'localhost',
      '--port', '5432',
      '--username', connection.user,
      ...args,
    ],
    env: process.env,
  };
}

/** Ejecuta y resuelve con la salida. Rechaza si el proceso termina mal. */
export function run({ command, args, env }, { stdout, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let errores = '';
    let salida = '';

    child.stderr.on('data', (chunk) => (errores += chunk.toString()));

    if (stdout) child.stdout.pipe(stdout);
    else child.stdout.on('data', (chunk) => (salida += chunk.toString()));

    if (stdin) stdin.pipe(child.stdin);

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(salida);
      else reject(new Error(`${command} terminó con código ${code}: ${errores}`));
    });
  });
}
