import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import type { z } from 'zod';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { idParamsSchema, type Page } from '../schemas/common.schema.js';
import type { AdminActionContext, AdminActionHooks } from '../services/admin-action.js';

/**
 * The five sports-catalog resources (T-06) share one shape: list, read,
 * create, edit, delete. Each one describes its schemas and service calls;
 * this turns that into Express handlers.
 */
export interface CatalogResource<T, Q, C, U> {
	listQuery: z.ZodType<Q>;
	createBody: z.ZodType<C>;
	updateBody: z.ZodType<U>;
	list(pool: Pool, query: Q): Promise<Page<T>>;
	get(pool: Pool, id: number): Promise<T>;
	create(pool: Pool, ctx: AdminActionContext, body: C): Promise<T>;
	update(pool: Pool, ctx: AdminActionContext, id: number, body: U): Promise<T>;
	remove(pool: Pool, ctx: AdminActionContext, id: number): Promise<void>;
}

export function createCatalogController<T, Q, C, U>(
	pool: Pool,
	resource: CatalogResource<T, Q, C, U>,
	hooks?: AdminActionHooks,
) {
	const ctx = (req: Parameters<RequestHandler>[0]): AdminActionContext => ({ actorId: authUser(req).id, hooks });
	const idOf = (req: Parameters<RequestHandler>[0]) => idParamsSchema.parse(req.params).id;

	const list: RequestHandler = async (req, res) => {
		sendSuccess(res, await resource.list(pool, resource.listQuery.parse(req.query)));
	};
	const get: RequestHandler = async (req, res) => {
		sendSuccess(res, await resource.get(pool, idOf(req)));
	};
	const create: RequestHandler = async (req, res) => {
		sendSuccess(res, await resource.create(pool, ctx(req), resource.createBody.parse(req.body)), 201);
	};
	const update: RequestHandler = async (req, res) => {
		const id = idOf(req);
		sendSuccess(res, await resource.update(pool, ctx(req), id, resource.updateBody.parse(req.body)));
	};
	const remove: RequestHandler = async (req, res) => {
		const id = idOf(req);
		await resource.remove(pool, ctx(req), id);
		sendSuccess(res, { id });
	};

	return { list, get, create, update, remove };
}
