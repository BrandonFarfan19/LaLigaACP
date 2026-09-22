import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { createHealthController } from '../controllers/health.controller.js';

export function createHealthRouter(pool: Pool): Router {
	const router = Router();
	router.get('/', createHealthController(pool));
	return router;
}
