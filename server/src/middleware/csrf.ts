import type { RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { textoParaLog } from '../lib/log-safe.js';
import { readSessionCookie } from '../lib/session-cookie.js';
import { csrfTokenFor, safeEqual } from '../lib/tokens.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Routes that open a session: there is no token yet to send. Covered by the Origin check and SameSite=Strict. */
const NO_TOKEN_PATHS = /^\/auth\/(login|register)\/?$/i;

export const CSRF_HEADER = 'x-csrf-token';

/**
 * CSRF protection for every state-changing request (NFR-005), no database
 * access needed:
 *
 * 1. A browser request whose `Origin` isn't the frontend's is rejected. This
 *    also blocks login CSRF on `/auth/login`. Clients that send no `Origin`
 *    (curl, server-to-server) don't carry the victim's cookie anyway.
 * 2. If the request carries a session cookie, the `X-CSRF-Token` header must
 *    equal `csrfTokenFor(cookie)`. The frontend gets that value from the
 *    login and `/auth/me` responses; a cross-site page can't read either.
 */
export function csrfProtection(env: Env): RequestHandler {
	return (req, _res, next) => {
		if (SAFE_METHODS.has(req.method)) return next();

		const origin = req.headers.origin;
		if (origin !== undefined && origin !== env.corsOrigin) {
			// La respuesta no dice qué esperaba el servidor: sería contar la
			// configuración a cualquiera. Pero sin dejarlo en ningún lado, quien
			// despliega queda a ciegas — el síntoma es "no puedo iniciar sesión" y
			// la causa suele ser un `https://` de más, una barra final o el puerto.
			// Va al registro del servidor, donde `docker logs` muestra la
			// diferencia exacta y nadie de afuera la ve.
			// `env.corsOrigin` va sin sanear a propósito: no es entrada del cliente
			// y no puede partir la línea. El analizador de URL de `parseCorsOrigin`
			// borra CR, LF y tabulación antes de mirar el texto, así que `url.origin`
			// no puede traerlos; lo fija una prueba en `tests/env.test.ts`.
			console.warn(
				`CSRF: origen no permitido en ${req.method} ${textoParaLog(req.path)}.` +
					` Origin recibido: ${textoParaLog(origin)} | CORS_ORIGIN configurado: ${env.corsOrigin}`,
			);
			throw HttpError.forbidden('Origen no permitido.', ErrorCode.CSRF_FAILED);
		}

		const sessionToken = readSessionCookie(req, env);
		if (sessionToken && !NO_TOKEN_PATHS.test(req.path)) {
			const sent = req.get(CSRF_HEADER);
			if (!sent || !safeEqual(sent, csrfTokenFor(sessionToken, env.session.secret))) {
				// Del token no se registra ni el valor recibido ni el esperado: el
				// esperado abre la sesión y el recibido puede ser el de otra. Basta
				// con distinguir las dos causas, que se arreglan distinto: ausente
				// suele ser un proxy que no reenvía la cabecera, e inválido, una
				// sesión que cambió sin que el front releyera `/auth/me`.
				console.warn(
					`CSRF: token ${sent ? 'inválido' : 'ausente'} en ${req.method} ${textoParaLog(req.path)}.`,
				);
				throw HttpError.forbidden('Token CSRF ausente o inválido.', ErrorCode.CSRF_FAILED);
			}
		}
		next();
	};
}
