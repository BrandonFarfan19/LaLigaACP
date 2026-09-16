import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from '../config/env.js';
import { createRequireAuth } from '../middleware/auth.js';
import { countBetsOnMatch, countPendingSelections } from '../services/bets-match-probe.service.js';
import { settleMatchBets } from '../services/bets-settlement.service.js';
import { createMediaStore } from '../services/media-storage.js';
import { imageUpload } from '../middleware/upload.js';
import { uploadRateLimit } from '../middleware/security.js';
import { betsOnSportGuard } from '../services/bets-sport-guard.service.js';
import { createAdminRouter } from './admin.route.js';
import { createAuthRouter } from './auth.route.js';
import { createBettingRouter } from './betting.route.js';
import { createCoinsRouter } from './coins.route.js';
import { createHealthRouter } from './health.route.js';
import { createPublicRouter } from './public.route.js';

/**
 * Every resource mounts here the same way: one `create<Resource>Router(...)`
 * per module, added to this list. Nothing outside this file knows the URL
 * layout of the app as a whole. `requireAuth` is built once and shared.
 */
export function createRouter(pool: Pool, env: Env): Router {
	const router = Router();
	const requireAuth = createRequireAuth(pool, env);
	const store = createMediaStore(env.uploads.dir);

	router.use('/health', createHealthRouter(pool));
	router.use('/auth', createAuthRouter(pool, env, requireAuth));
	router.use('/public', createPublicRouter(pool, env, store));
	router.use('/monedas', createCoinsRouter(pool, requireAuth));
	router.use('/apuestas', createBettingRouter(pool, requireAuth));
	// Composition root: the Polla module's checks (BR-015 draw rule, bets on a
	// match, pending selections) and its settler (T-12/T-14) reach the Informativo
	// routes here, so Informativo never imports Polla.
	router.use(
		'/admin',
		createAdminRouter(pool, requireAuth, {
			catalog: {
				drawRuleGuards: [betsOnSportGuard],
				countBetsOnMatch,
				countPendingSelections,
				settleMatch: settleMatchBets,
				media: {
					deps: { store, maxPixels: env.uploads.maxPixels },
					parseImage: imageUpload(env),
					uploadLimit: uploadRateLimit(env),
				},
			},
			store,
		}),
	);
	return router;
}
