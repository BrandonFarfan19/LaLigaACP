#!/usr/bin/env node
/**
 * Genera el volcado de los datos reales del Módulo Informativo para llevarlos
 * a producción: `deporte`, `competicion`, `equipo`, `jugador` y `plantel`.
 *
 * SOLO LEE. Las dos únicas cosas que corre contra MySQL son `mysqldump` y
 * `SELECT COUNT(*)`; no hay una sola escritura en este archivo, ni siquiera
 * para una tabla temporal. El archivo que produce sí escribe, pero se carga a
 * mano en el servidor y trae su propia barrera (aborta si la base ya tiene
 * datos). Ver el README, "Llevar los datos reales a producción".
 *
 * Qué NO exporta, a propósito:
 * - Los 9 catálogos (`rol`, `estado_usuario`, `estado_pago`, `estado_partido`,
 *   `tipo_apuesta`, `resultado_general`, `estado_seleccion`, `tipo_movimiento`,
 *   `accion_auditoria`): los carga `db/init/02-catalogos.sql` al crear el
 *   volumen, y repetirlos rompe por `codigo` único.
 * - `usuario`, `sesion`, `auditoria` y todo Polla (`ticket`, `seleccion`,
 *   `movimiento_moneda`): llevar hashes de contraseña y sesiones de una base de
 *   desarrollo a un servidor real es justo lo que no hay que hacer. El
 *   administrador de producción se crea allá con `create-admin`.
 *
 * Uso:  npm run db:export-real
 *       npm run db:export-real -- --salida db/datos-reales.sql
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** En este orden: es el de las claves foráneas, y mysqldump respeta el orden dado. */
const TABLAS = ['deporte', 'competicion', 'equipo', 'jugador', 'plantel'];

/** Los catálogos que ya carga `02-catalogos.sql`. Ninguno puede salir en el volcado. */
const CATALOGOS = [
	'rol',
	'estado_usuario',
	'estado_pago',
	'estado_partido',
	'tipo_apuesta',
	'resultado_general',
	'estado_seleccion',
	'tipo_movimiento',
	'accion_auditoria',
];

/** Tablas con datos de cuentas o de la polla. Ninguna puede salir en el volcado. */
const PROHIBIDAS = ['usuario', 'sesion', 'auditoria', 'ticket', 'seleccion', 'movimiento_moneda'];

function argumento(nombre, porDefecto) {
	const i = process.argv.indexOf(`--${nombre}`);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

/** Las variables del `.env` de la raíz, sin dependencias: solo se leen. */
function leerEnv() {
	const env = {};
	let texto;
	try {
		texto = execFileSync(process.platform === 'win32' ? 'cmd' : 'cat', process.platform === 'win32' ? ['/c', 'type', '.env'] : ['.env'], {
			encoding: 'utf8',
		});
	} catch {
		throw new Error('No se pudo leer el .env de la raíz. Copialo desde .env.example primero.');
	}
	for (const linea of texto.split(/\r?\n/)) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
		if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
	}
	return env;
}

/** Corre algo dentro del contenedor `db` del compose de DESARROLLO. */
function enDb(argumentos, entrada) {
	return execFileSync('docker', ['compose', 'exec', '-T', 'db', ...argumentos], {
		encoding: 'utf8',
		input: entrada,
		maxBuffer: 64 * 1024 * 1024,
	});
}

function main() {
	const env = leerEnv();
	const base = env.MYSQL_DATABASE;
	const clave = env.MYSQL_ROOT_PASSWORD;
	if (!base) throw new Error('Falta MYSQL_DATABASE en el .env.');
	if (!clave) throw new Error('Falta MYSQL_ROOT_PASSWORD en el .env.');
	if (/test/i.test(base)) {
		throw new Error(`MYSQL_DATABASE es "${base}", que parece una base de pruebas. Este volcado es de la base de desarrollo real.`);
	}

	const salida = resolve(argumento('salida', 'db/datos-reales.sql'));

	// 1. Los conteos de origen. Es la única consulta, y es de lectura.
	const consulta = TABLAS.map((t) => `SELECT '${t}' AS tabla, COUNT(*) AS filas FROM \`${t}\``).join(' UNION ALL ');
	const salidaConteos = enDb(['mysql', `-u${'root'}`, `-p${clave}`, '--default-character-set=utf8mb4', '-N', '-B', base, '-e', consulta]);
	const conteos = new Map(
		salidaConteos
			.trim()
			.split(/\r?\n/)
			.map((linea) => linea.split('\t'))
			.map(([tabla, filas]) => [tabla, Number(filas)]),
	);
	for (const tabla of TABLAS) {
		if (!Number.isInteger(conteos.get(tabla))) throw new Error(`No se pudo contar ${tabla}.`);
	}

	// 2. El volcado. `--single-transaction` es una instantánea consistente y sin
	//    bloquear a nadie; `--complete-insert` nombra las columnas, así que los
	//    ids viajan explícitos (las URLs son /plantilla/42 y `plantel` apunta a
	//    equipos y jugadores por id); `--skip-extended-insert` deja una fila por
	//    INSERT, que se lee y se diffea; `--no-create-info` porque el esquema lo
	//    crea `01-schema.sql` en producción.
	const volcado = enDb([
		'mysqldump',
		'-uroot',
		`-p${clave}`,
		'--default-character-set=utf8mb4',
		'--single-transaction',
		'--no-create-info',
		'--complete-insert',
		'--skip-extended-insert',
		'--no-tablespaces',
		'--skip-add-locks',
		'--skip-disable-keys',
		'--skip-comments',
		base,
		...TABLAS,
	]);

	// 3. mysqldump apaga las claves foráneas en su preámbulo. Acá se quiere lo
	//    contrario: que un archivo truncado no pueda dejar un plantel apuntando
	//    a un equipo que no entró. Se quitan esas líneas y se fija ON abajo.
	const cuerpo = volcado
		.split(/\r?\n/)
		.filter((l) => !/FOREIGN_KEY_CHECKS/i.test(l) && !/UNIQUE_CHECKS/i.test(l) && !/^\/\*!\d+ SET (SQL_MODE|TIME_ZONE|SQL_NOTES|CHARACTER_SET|COLLATION|NAMES)/i.test(l) && !/^\/\*!\d+ SET @OLD/i.test(l))
		.join('\n')
		.trim();

	for (const prohibida of [...CATALOGOS, ...PROHIBIDAS]) {
		const patron = new RegExp(`INSERT INTO \`?${prohibida}\`?[ (]`, 'i');
		if (patron.test(cuerpo)) throw new Error(`El volcado trae filas de "${prohibida}", que no debe viajar. Abortado.`);
	}

	const esperado = TABLAS.map((t) => `${t}=${conteos.get(t)}`).join(', ');
	writeFileSync(salida, archivo(cuerpo, conteos, base, esperado), 'utf8');

	console.log(`Volcado escrito en ${salida}`);
	console.log(`Filas: ${esperado}`);
	console.log('La base de desarrollo no se modificó: solo se corrieron mysqldump y SELECT.');
}

/** Una comprobación que aborta el script con un nombre legible si no se cumple. */
function guardia(condicion, nombreDelError, mensajeOk) {
	// El SQL que falla se arma como texto y solo se analiza si esa rama se
	// elige: MySQL resuelve las tablas al preparar, así que escribirlo suelto
	// fallaría siempre. Con PREPARE, el error aparece solo cuando corresponde,
	// y `mysql` corta el script entero en el primer error (sin --force), así
	// que la transacción de abajo nunca llega a COMMIT.
	// El mensaje va dentro de una cadena SQL que a su vez es una cadena SQL, así
	// que sus comillas simples se doblan: 'SELECT ''texto'' AS control'.
	const mensaje = mensajeOk.replace(/'/g, "''");
	return `SET @ok := (${condicion});
SET @sql := IF(@ok, 'SELECT ''${mensaje}'' AS control', 'SELECT * FROM \`${nombreDelError}\`');
PREPARE comprobacion FROM @sql;
EXECUTE comprobacion;
DEALLOCATE PREPARE comprobacion;`;
}

function archivo(cuerpo, conteos, base, esperado) {
	const vacias = TABLAS.map((t) => `(SELECT COUNT(*) FROM \`${t}\`)`).join(' + ');
	const bien = TABLAS.map((t) => `(SELECT COUNT(*) FROM \`${t}\`) = ${conteos.get(t)}`).join('\n    AND ');

	return `-- Datos reales del Módulo Informativo de La Liga ACP.
-- GENERADO por db/export-datos-reales.mjs desde la base "${base}". No editar a mano.
-- Generado: ${new Date().toISOString()}
--
-- Contiene, en orden de claves foráneas: ${esperado}.
-- NO contiene los 9 catálogos (los carga db/init/02-catalogos.sql) ni ninguna
-- tabla de cuentas o de la polla. Los ids viajan explícitos y se conservan:
-- las URLs de la app son /plantilla/42 y plantel apunta por id.
--
-- Cómo cargarlo está en el README, "Llevar los datos reales a producción".
-- Hay que entrar como root de MySQL: el usuario de la aplicación no tiene
-- permiso para desactivar nada ni para leer information_schema completo.
--
-- Si se corre DOS VECES falla de forma limpia y no duplica ni una fila: la
-- comprobación de abajo aborta antes de insertar nada, y todo va dentro de una
-- transacción. Se eligió fallar en vez de ser idempotente (INSERT IGNORE o
-- REPLACE) a propósito: esto es una carga inicial única sobre una base vacía, y
-- si las tablas ya tienen algo, lo correcto es detenerse y mirar por qué, no
-- mezclar en silencio con lo que hubiera.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @@session.sql_mode = CONCAT(@@session.sql_mode, ',STRICT_ALL_TABLES');
-- Las claves foráneas quedan ACTIVAS: si el archivo llegara cortado, un
-- plantel sin su equipo o sin su jugador hace fallar la carga en vez de
-- dejar la base a medio llenar.
SET FOREIGN_KEY_CHECKS = 1;
SET UNIQUE_CHECKS = 1;
SET autocommit = 0;

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- Barrera: las cinco tablas tienen que estar vacías.
-- ---------------------------------------------------------------------------
${guardia(`(${vacias}) = 0`, 'ABORTADO_la_base_ya_tiene_datos_informativos', 'Base vacía: se puede cargar')}

-- ---------------------------------------------------------------------------
-- Los datos.
-- ---------------------------------------------------------------------------
${cuerpo}

-- ---------------------------------------------------------------------------
-- Verificación: los conteos tienen que ser exactamente los del origen.
-- ---------------------------------------------------------------------------
SELECT 'deporte' AS tabla, COUNT(*) AS filas, ${conteos.get('deporte')} AS esperadas FROM \`deporte\`
UNION ALL SELECT 'competicion', COUNT(*), ${conteos.get('competicion')} FROM \`competicion\`
UNION ALL SELECT 'equipo', COUNT(*), ${conteos.get('equipo')} FROM \`equipo\`
UNION ALL SELECT 'jugador', COUNT(*), ${conteos.get('jugador')} FROM \`jugador\`
UNION ALL SELECT 'plantel', COUNT(*), ${conteos.get('plantel')} FROM \`plantel\`;

${guardia(`${bien}`, 'VERIFICACION_FALLIDA_los_conteos_no_coinciden', 'Verificación OK')}

COMMIT;

SELECT 'Carga completa y verificada.' AS resultado;
`;
}

try {
	const destino = resolve(argumento('salida', 'db/datos-reales.sql'));
	mkdirSync(dirname(destino), { recursive: true });
	main();
} catch (error) {
	console.error(`\nERROR: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
