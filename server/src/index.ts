import { createApp } from './app.js';
import { env } from './config/env.js';
import { createPool } from './db/pool.js';

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
