import type { BettingMatch, GeneralResult, SelectionInput } from '../types/betting';
import { MAX_GOALS, MAX_SELECTIONS, newIdempotencyKey } from './betting';

/**
 * The ticket being built (BR-019, BR-023, BR-024) before it is confirmed.
 * D-012: it lives in `sessionStorage`, per user, so a reload or a tab switch
 * on a phone doesn't lose it; it is removed on confirming, emptying or
 * signing out. It moves no coins and is worth nothing until confirmed: the
 * backend checks everything again.
 *
 * Every change of the selections gets a new idempotency key (BR-054): the key
 * names one confirmation attempt of exactly these selections, and is kept
 * for a retry after a network error or a double click.
 */

/** What a selection shows in the ticket, copied from the match card when it was added. */
export interface DraftMatch {
	id: number;
	local: string;
	visita: string;
	competicion: string;
	/** Kick-off, UTC. */
	fechaHora: string;
}

export interface DraftSelection {
	/** Local id, only for the list (React keys, remove). */
	id: string;
	input: SelectionInput;
	match: DraftMatch;
}

export interface TicketDraft {
	userId: number;
	items: DraftSelection[];
	idempotencyKey: string;
}

const PREFIX = 'la-liga-acp:ticket:';
const storageKey = (userId: number) => `${PREFIX}${userId}`;

function storage(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

export function emptyDraft(userId: number): TicketDraft {
	return { userId, items: [], idempotencyKey: newIdempotencyKey() };
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isGoals = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_GOALS;
const RESULTS: readonly string[] = ['local_gana', 'empate', 'visitante_gana'];

/** A lowercase UUID, exactly: nothing before or after it (no spaces, no CRLF). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isIdempotencyKey = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * A selection with only the fields of its type, or `null` when it isn't one
 * (T-19 fix). What reaches the backend is always built here, so a stored or
 * posted object with extra fields (`usuarioId`, goals on a general result...)
 * never travels as it came.
 */
export function selectionInputOf(value: unknown): SelectionInput | null {
	if (!isObject(value) || !isId(value.partidoId)) return null;
	if (value.tipo === 'resultado_general') {
		return typeof value.pronostico === 'string' && RESULTS.includes(value.pronostico)
			? { partidoId: value.partidoId, tipo: 'resultado_general', pronostico: value.pronostico as GeneralResult }
			: null;
	}
	if (value.tipo === 'marcador_exacto') {
		return isGoals(value.golesLocal) && isGoals(value.golesVisitante)
			? { partidoId: value.partidoId, tipo: 'marcador_exacto', golesLocal: value.golesLocal, golesVisitante: value.golesVisitante }
			: null;
	}
	return null;
}

const MAX_TEXT = 200;
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEXT;
/** An ISO 8601 instant with its zone, as the API sends it. */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** Real zone offsets go from UTC−12:00 to UTC+14:00, in minutes. */
const MIN_OFFSET = -12 * 60;
const MAX_OFFSET = 14 * 60;

/**
 * A real instant, checked field by field (T-19 fix): `Date` would quietly turn
 * February 30 into March 2, or 24:00:00 into the next day.
 */
function isInstant(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const match = ISO_INSTANT.exec(value);
	if (!match) return false;
	const [y, mo, d, h, mi, s] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
	const [sign, offsetHours = '0', offsetMinutes = '0'] = match.slice(7);
	const oh = Number(offsetHours);
	const om = Number(offsetMinutes);
	const offset = (sign === '-' ? -1 : 1) * (oh * 60 + om);
	const date = new Date(Date.UTC(y, mo - 1, d));
	const realDay = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
	const realOffset = om <= 59 && offset >= MIN_OFFSET && offset <= MAX_OFFSET;
	return realDay && y >= 2000 && y < 2100 && h <= 23 && mi <= 59 && s <= 59 && realOffset;
}

/** The match shown next to a selection, or `null` when it isn't a well-formed one for that match. */
function draftMatchFrom(value: unknown, partidoId: number): DraftMatch | null {
	if (!isObject(value) || value.id !== partidoId) return null;
	if (!isText(value.local) || !isText(value.visita) || !isText(value.competicion) || !isInstant(value.fechaHora)) return null;
	return { id: partidoId, local: value.local, visita: value.visita, competicion: value.competicion, fechaHora: value.fechaHora };
}

const LOCAL_ID = /^[a-z0-9]{1,40}$/;

/** Why stored selections were dropped, in plain words for the user. */
export type DropReason = 'pronostico' | 'partido' | 'maximo';

export interface DraftLoad {
	draft: TicketDraft;
	/** Stored selections that were left out. */
	dropped: number;
	reasons: DropReason[];
}

/**
 * The saved draft of that user, or an empty one, and what was left out (T-19
 * fix). Everything is checked: the match shown, the selection by type, the
 * ids and goals, and the key. A bad selection is dropped (never the page); a
 * repeated local id gets a new one; if anything was dropped or the key isn't
 * a UUID, the draft gets a new key, since the old one named other selections.
 * A stored value that isn't a draft at all starts empty without a report.
 */
export function readDraft(userId: number): DraftLoad {
	const nothing = (): DraftLoad => ({ draft: emptyDraft(userId), dropped: 0, reasons: [] });
	try {
		const raw = storage()?.getItem(storageKey(userId));
		if (!raw) return nothing();
		const parsed: unknown = JSON.parse(raw);
		if (!isObject(parsed) || parsed.userId !== userId || !Array.isArray(parsed.items)) return nothing();
		const items: DraftSelection[] = [];
		const seen = new Set<string>();
		const reasons = new Set<DropReason>();
		let dropped = Math.max(0, parsed.items.length - MAX_SELECTIONS);
		if (dropped > 0) reasons.add('maximo');
		let changed = dropped > 0;
		for (const entry of parsed.items.slice(0, MAX_SELECTIONS)) {
			const input = isObject(entry) ? selectionInputOf(entry.input) : null;
			const match = input && isObject(entry) ? draftMatchFrom(entry.match, input.partidoId) : null;
			if (!input || !match || !isObject(entry)) {
				changed = true;
				dropped++;
				reasons.add(input ? 'partido' : 'pronostico');
				continue;
			}
			if (JSON.stringify(input) !== JSON.stringify(entry.input)) changed = true;
			let id = typeof entry.id === 'string' && LOCAL_ID.test(entry.id) ? entry.id : '';
			if (!id || seen.has(id)) id = localId();
			seen.add(id);
			items.push({ id, input, match });
		}
		const key = !changed && isIdempotencyKey(parsed.idempotencyKey) ? parsed.idempotencyKey : newIdempotencyKey();
		return { draft: { userId, items, idempotencyKey: key }, dropped, reasons: [...reasons] };
	} catch {
		return nothing();
	}
}

/** The saved draft of that user, or an empty one (see `readDraft`). */
export function loadDraft(userId: number): TicketDraft {
	return readDraft(userId).draft;
}

const DROP_REASON_TEXT: Record<DropReason, string> = {
	pronostico: 'su pronóstico no era válido',
	partido: 'faltaban datos de su partido',
	maximo: 'pasaban del máximo de 50',
};

/** "Se quitaron 2 selecciones guardadas de tu ticket porque ...": what the user is told. */
export function droppedNotice(dropped: number, reasons: readonly DropReason[]): string | null {
	if (dropped === 0) return null;
	const what = dropped === 1 ? 'Se quitó 1 selección guardada' : `Se quitaron ${dropped} selecciones guardadas`;
	const why = reasons.map((reason) => DROP_REASON_TEXT[reason]).join(' o ');
	return `${what} de tu ticket porque ${why}. Revisa el ticket antes de confirmar.`;
}

export function saveDraft(draft: TicketDraft): void {
	try {
		const store = storage();
		if (!store) return;
		if (draft.items.length === 0) store.removeItem(storageKey(draft.userId));
		else store.setItem(storageKey(draft.userId), JSON.stringify(draft));
	} catch {
		// Full or blocked storage: the draft still works for this page.
	}
}

export function clearDraft(userId: number): void {
	try {
		storage()?.removeItem(storageKey(userId));
	} catch {
		// Nothing to do.
	}
}

/** Signing out removes every saved draft of this tab. */
export function clearAllDrafts(): void {
	const store = storage();
	if (!store) return;
	try {
		for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key);
	} catch {
		// Nothing to do.
	}
}

let counter = 0;
const localId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

export function draftMatchOf(match: BettingMatch): DraftMatch {
	return {
		id: match.id,
		local: match.local.equipo.nombre,
		visita: match.visita.equipo.nombre,
		competicion: match.competicion.nombre,
		fechaHora: match.fechaHora,
	};
}

/** Adds a selection (repeats allowed, BR-017), up to `MAX_SELECTIONS`. Returns the same draft if full. */
export function addSelection(draft: TicketDraft, input: SelectionInput, match: DraftMatch): TicketDraft {
	if (draft.items.length >= MAX_SELECTIONS) return draft;
	return { ...draft, items: [...draft.items, { id: localId(), input, match }], idempotencyKey: newIdempotencyKey() };
}

/**
 * The same draft with each match's data (teams, competition, kick-off) taken
 * from `fresh` when it has that match: a postponed kick-off shows its new
 * date. The selections and the key don't change. Returns the same draft when
 * nothing changed.
 */
export function refreshMatches(draft: TicketDraft, fresh: ReadonlyMap<number, DraftMatch>): TicketDraft {
	let changed = false;
	const items = draft.items.map((item) => {
		const match = fresh.get(item.input.partidoId);
		if (!match || JSON.stringify(match) === JSON.stringify(item.match)) return item;
		changed = true;
		return { ...item, match };
	});
	return changed ? { ...draft, items } : draft;
}

export function removeSelection(draft: TicketDraft, id: string): TicketDraft {
	return { ...draft, items: draft.items.filter((item) => item.id !== id), idempotencyKey: newIdempotencyKey() };
}

/** Same selections, a new key: after the backend says the key was used for another ticket. */
export function renewKey(draft: TicketDraft): TicketDraft {
	return { ...draft, idempotencyKey: newIdempotencyKey() };
}

export const sameInput = (a: SelectionInput, b: SelectionInput) => JSON.stringify(a) === JSON.stringify(b);

/** Index of an earlier identical selection (BR-017 repeats), or `null`. */
export function repeatOf(items: readonly DraftSelection[], index: number): number | null {
	const found = items.findIndex((item, i) => i < index && sameInput(item.input, items[index]!.input));
	return found === -1 ? null : found;
}
