import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { listAuditQuery } from '../schemas/audit.schema.js';
import { listAudit } from '../services/audit.service.js';

/**
 * `/admin/auditoria` (T-17, Módulo Auditoría, NFR-006), behind the admin
 * router's session and role checks. Read only: there is no route that writes,
 * edits or deletes audit records (any other verb is a 404).
 *
 *   GET /admin/auditoria?page=&pageSize=&accion=&entidad=&entidadId=&usuarioId=&desde=&hasta=
 */
export function createAuditRouter(pool: Pool): Router {
	const router = Router();
	router.get('/', async (req, res) => {
		sendSuccess(res, await listAudit(pool, listAuditQuery.parse(req.query)));
	});
	return router;
}
