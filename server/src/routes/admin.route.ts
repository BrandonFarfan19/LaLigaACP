import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { serveImage } from '../controllers/media.controller.js';
import { authUser, requireRole } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';
import { type CatalogRouterOptions, createCatalogRouter } from './catalog.route.js';
import { createAdminCoinsRouter } from './coins.route.js';
import { createParticipantsRouter } from './participants.route.js';
import type { MediaStore } from '../services/media-storage.js';

/**
 * Everything under `/admin` requires a session (401) and the `admin` role
 * (403), applied once here. Admin resources mount on this router.
 */
export interface AdminRouterOptions {
	catalog: CatalogRouterOptions;
	/** T-13: uploaded images. */
	store: MediaStore;
}

export function createAdminRouter(pool: Pool, requireAuth: RequestHandler, options: AdminRouterOptions): Router {
	const router = Router();
	router.use(requireAuth, requireRole('admin'));

	/** Only confirms the guard. */
	router.get('/sesion', rejectQueryParams, (req, res) => {
		const { id, nombre, rol } = authUser(req);
		sendSuccess(res, { id, nombre, rol });
	});

	/** T-13: any match's uploaded image, for the admin screens. */
	router.get('/archivos/:nombre', rejectQueryParams, serveImage(pool, options.store, 'admin'));
	router.use('/participantes', createParticipantsRouter(pool));
	router.use('/monedas', createAdminCoinsRouter(pool));
	router.use(createCatalogRouter(pool, options.catalog));

	return router;
}
