import { createApp } from './app.js';
import { ConfigError, loadEnv, type Env } from './config/env.js';
import { createPool } from './db/pool.js';

/** An incomplete environment is an operator mistake, not a crash: print what's wrong and exit 1, no stack trace. */
function loadEnvOrExit(): Env {
	try {
		return loadEnv();
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(error.message);
			process.exit(1);
		}
		throw error;
	}
}

const env = loadEnvOrExit();
const pool = createPool(env);
const app = createApp({ pool, env });

const server = app.listen(env.port, () => {
	console.log(`La Liga ACP API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
});

/** Closes the HTTP server and the pool's connections before the process exits. */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
	console.log(`${signal} recibido, cerrando...`);
	server.close(() => {
		pool
			.end()
			.catch((error: unknown) => console.error('Error cerrando el pool de MySQL:', error))
			.finally(() => process.exit(0));
	});
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
