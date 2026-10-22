// Pure logic for Quiet Board: parsing, validation, freshness ("fog") and age
// formatting. No `obsidian` import, so Node's test runner can load it directly.
// Only erasable TypeScript syntax is used here (Node strips the types).

export const SPEC = "quiet-board/1";

export type Tone = "neutral" | "up" | "down" | "warn" | "muted";
const TONES: readonly string[] = ["neutral", "up", "down", "warn", "muted"];

/** Freshness inputs as written in the file (strings and seconds). */
export interface Stamp {
	as_of?: string;
	stale_after?: number;
}

export interface CardItem extends Stamp {
	label: string;
	value: string;
	note?: string;
	delta?: string;
	tone: Tone;
}

export interface LineItem extends Stamp {
	text: string;
	tone: Tone;
}

interface BlockBase {
	id: string;
	title: string;
	as_of: string;
	stale_after?: number;
}

export interface CardsBlock extends BlockBase {
	kind: "cards";
	items: CardItem[];
}

export interface LinesBlock extends BlockBase {
	kind: "lines";
	items: LineItem[];
	empty?: string;
}

export interface SparkBlock extends BlockBase {
	kind: "spark";
	value: string;
	delta?: string;
	tone: Tone;
	points: [number, number][]; // [epoch ms, value], oldest first
}

/** A block that could not be drawn: unknown kind or a format error. */
export interface NoteBlock {
	kind: "note";
	id: string;
	title: string;
	message: string;
}

export type Block = CardsBlock | LinesBlock | SparkBlock | NoteBlock;

export interface Board {
	spec: string;
	title: string;
	written_at: string;
	writtenMs: number;
	stale_after?: number;
	tz?: string;
	blocks: Block[];
}

export type ParseResult =
	| { ok: true; board: Board }
	| { ok: false; reason: "json" | "spec" | "format"; message: string };

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

function seconds(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function tone(v: unknown): Tone {
	return typeof v === "string" && TONES.includes(v) ? (v as Tone) : "neutral";
}

/** Parse the file text. Never throws. */
export function parseBoard(text: string): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch (e) {
		return { ok: false, reason: "json", message: e instanceof Error ? e.message : String(e) };
	}
	if (!isObj(raw)) return { ok: false, reason: "format", message: "the file is not a JSON object" };
	if (raw.spec !== SPEC) {
		const got = typeof raw.spec === "string" ? `"${raw.spec}"` : "no spec";
		return { ok: false, reason: "spec", message: `the file has ${got}; Quiet Board reads "${SPEC}"` };
	}
	const written = str(raw.written_at);
	const writtenMs = written === undefined ? NaN : parseIsoTime(written);
	if (written === undefined || Number.isNaN(writtenMs)) {
		return { ok: false, reason: "format", message: "written_at is missing or not an ISO time" };
	}
	if (!Array.isArray(raw.blocks)) {
		return { ok: false, reason: "format", message: "blocks is missing or not an array" };
	}
	const tz = str(raw.tz);
	const blocks = raw.blocks.map((b, i) => normalizeBlock(b, i));
	return {
		ok: true,
		board: {
			spec: SPEC,
			title: str(raw.title) ?? "",
			written_at: written,
			writtenMs,
			stale_after: seconds(raw.stale_after),
			tz: tz !== undefined && isValidTimeZone(tz) ? tz : undefined,
			blocks,
		},
	};
}

function normalizeBlock(b: unknown, index: number): Block {
	if (!isObj(b)) return { kind: "note", id: `#${index + 1}`, title: "", message: "block is not an object" };
	const id = str(b.id) ?? `#${index + 1}`;
	const title = str(b.title) ?? "";
	const kind = b.kind;
	if (kind !== "cards" && kind !== "lines" && kind !== "spark") {
		return { kind: "note", id, title, message: "unknown block kind" };
	}
	const asOf = str(b.as_of);
	if (asOf === undefined) return { kind: "note", id, title, message: "block has no as_of" };
	const base = { id, title, as_of: asOf, stale_after: seconds(b.stale_after) };
	const items = Array.isArray(b.items) ? b.items.filter(isObj) : [];
	if (kind === "cards") {
		return {
			...base,
			kind,
			items: items.map((it) => ({
				label: str(it.label) ?? "",
				value: str(it.value) ?? "",
				note: str(it.note),
				delta: str(it.delta),
				tone: tone(it.tone),
				as_of: str(it.as_of),
				stale_after: seconds(it.stale_after),
			})),
		};
	}
	if (kind === "lines") {
		return {
			...base,
			kind,
			items: items.map((it) => ({
				text: str(it.text) ?? "",
				tone: tone(it.tone),
				as_of: str(it.as_of),
				stale_after: seconds(it.stale_after),
			})),
			empty: str(b.empty),
		};
	}
	const points: [number, number][] = [];
	if (Array.isArray(b.points)) {
		// Keep only the newest MAX_POINTS entries (the file lists oldest first).
		for (const p of b.points.slice(-MAX_POINTS)) {
			if (!Array.isArray(p) || p.length < 2) continue;
			const t = typeof p[0] === "string" ? parseIsoTime(p[0]) : NaN;
			const v = p[1];
			if (!Number.isNaN(t) && typeof v === "number" && Number.isFinite(v)) points.push([t, v]);
		}
	}
	return { ...base, kind, value: str(b.value) ?? "", delta: str(b.delta), tone: tone(b.tone), points };
}

/** Spark points kept per block; older ones are dropped. */
export const MAX_POINTS = 500;

/** A stamp more than this far in the future is treated as unreadable (fogged). */
export const FUTURE_SLACK_MS = 60 * 60 * 1000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// ISO datetime with an explicit zone (Z or +hh:mm). A datetime with no zone is
// rejected rather than guessed, because the spec says ISO UTC.
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** True when y-m-d is a real calendar day (no roll-over: 2026-02-30 is false). */
function realDate(y: number, m: number, d: number): boolean {
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function parseIsoTime(s: string): number {
	const m = ISO_TIME.exec(s);
	if (!m || !realDate(Number(m[1]), Number(m[2]), Number(m[3]))) return NaN;
	return Date.parse(s);
}

export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (local - UTC). */
export function tzOffsetMs(ms: number, tz: string | undefined): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(ms));
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
	const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
	return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Turn an `as_of` string into epoch ms. A `YYYY-MM-DD` date counts as
 * 23:59:59 of that day in `tz` (machine zone when `tz` is undefined).
 * Returns NaN when the string is neither form.
 */
export function asOfToMs(s: string, tz: string | undefined): number {
	return stampMs(s, tz, true);
}

/**
 * Epoch ms of a stamp. A `YYYY-MM-DD` date resolves to 23:59:59 of that day
 * in `tz` when `endOfDay`, otherwise to 00:00:00 (its start, used to decide
 * whether the stamp lies in the future).
 */
function stampMs(s: string, tz: string | undefined, endOfDay: boolean): number {
	const m = DATE_ONLY.exec(s);
	if (!m) return parseIsoTime(s);
	if (!realDate(Number(m[1]), Number(m[2]), Number(m[3]))) return NaN;
	const wall = endOfDay
		? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59)
		: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);
	// Two passes settle the offset across a DST change.
	let guess = wall - tzOffsetMs(wall, tz);
	guess = wall - tzOffsetMs(guess, tz);
	return guess;
}

export interface Freshness {
	/**
	 * Age in ms (0 when as_of is up to an hour in the future); null when as_of
	 * is unreadable or more than an hour in the future.
	 */
	ageMs: number | null;
	stale: boolean;
}

/**
 * Freshness of an item inside a block. The item's own `as_of` and
 * `stale_after` win over the block's, field by field. A stamp more than
 * FUTURE_SLACK_MS ahead of now is fogged like an unreadable one. `forceFog`
 * (used after a failed read) fogs everything.
 */
export function freshness(
	item: Stamp | undefined,
	block: Stamp,
	tz: string | undefined,
	nowMs: number,
	forceFog = false,
): Freshness {
	const asOf = item?.as_of ?? block.as_of;
	const staleAfter = item?.stale_after ?? block.stale_after;
	const ms = asOf === undefined ? NaN : asOfToMs(asOf, tz);
	if (Number.isNaN(ms)) return { ageMs: null, stale: true };
	// Future check from the start of a date-only stamp's day, so today's date
	// is never "in the future" at noon.
	if (stampMs(asOf as string, tz, false) - nowMs > FUTURE_SLACK_MS) return { ageMs: null, stale: true };
	const ageMs = Math.max(0, nowMs - ms);
	const stale = forceFog || (staleAfter !== undefined && ageMs > staleAfter * 1000);
	return { ageMs, stale };
}

/** `45 m`, `3 h`, `12 d`. Under an hour: minutes; under two days: hours; then days. */
export function formatAge(ageMs: number): string {
	const min = Math.floor(Math.max(0, ageMs) / 60000);
	if (min < 60) return `${min} m`;
	const h = Math.floor(min / 60);
	if (h < 48) return `${h} h`;
	return `${Math.floor(h / 24)} d`;
}

/** Chip text: `2 h` when fresh, `unknown · 3 h` when fogged, `unknown` when unreadable. */
export function chipText(f: Freshness): string {
	if (f.ageMs === null) return "unknown";
	return f.stale ? `unknown · ${formatAge(f.ageMs)}` : formatAge(f.ageMs);
}

/** `19:12` in `tz`, prefixed with `YYYY-MM-DD ` when not today in `tz`. */
export function formatClock(ms: number, tz: string | undefined, nowMs: number): string {
	const day = (t: number) =>
		new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
			new Date(t),
		);
	const clock = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		hourCycle: "h23",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(ms));
	return day(ms) === day(nowMs) ? clock : `${day(ms)} ${clock}`;
}

/** Whether written_at is more than FUTURE_SLACK_MS ahead of now (a wrong clock). */
export function boardFromFuture(board: Board, nowMs: number): boolean {
	return board.writtenMs - nowMs > FUTURE_SLACK_MS;
}

/** Whether the board as a whole is stale: past its stale_after, or stamped in the future. */
export function boardStale(board: Board, nowMs: number): boolean {
	if (boardFromFuture(board, nowMs)) return true;
	return board.stale_after !== undefined && nowMs - board.writtenMs > board.stale_after * 1000;
}

/**
 * Time and value range of spark points. A loop, not Math.min(...arr):
 * spreading a huge array throws RangeError (call stack overflow).
 */
export function sparkBounds(points: [number, number][]): { t0: number; t1: number; v0: number; v1: number } {
	let t0 = Infinity;
	let t1 = -Infinity;
	let v0 = Infinity;
	let v1 = -Infinity;
	for (const [t, v] of points) {
		if (t < t0) t0 = t;
		if (t > t1) t1 = t;
		if (v < v0) v0 = v;
		if (v > v1) v1 = v;
	}
	return { t0, t1, v0, v1 };
}

/** CSS class for a block id: `qb-block-id-<id>`, lower-cased, anything outside [a-z0-9-] becomes `-`. */
export function blockIdClass(id: string): string {
	return `qb-block-id-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}
