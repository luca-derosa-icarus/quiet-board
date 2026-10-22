import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseBoard,
	freshness,
	asOfToMs,
	formatAge,
	chipText,
	formatClock,
	boardStale,
	boardFromFuture,
	sparkBounds,
	blockIdClass,
	MAX_POINTS,
} from "../src/board.ts";

const H = 3600 * 1000;
const D = 24 * H;

function board(blocks, extra = {}) {
	return JSON.stringify({ spec: "quiet-board/1", title: "T", written_at: "2026-01-10T12:00:00Z", blocks, ...extra });
}

test("a fresh item is not fogged and shows its age", () => {
	const now = Date.parse("2026-01-10T14:00:00Z");
	const f = freshness(undefined, { as_of: "2026-01-10T12:00:00Z", stale_after: 86400 }, "UTC", now);
	assert.equal(f.stale, false);
	assert.equal(chipText(f), "2 h");
});

test("a stale item is fogged with an unknown chip", () => {
	const now = Date.parse("2026-01-10T15:00:00Z");
	const f = freshness({ as_of: "2026-01-10T12:00:00Z", stale_after: 3600 }, { as_of: "2026-01-10T14:59:00Z" }, "UTC", now);
	assert.equal(f.stale, true);
	assert.equal(chipText(f), "unknown · 3 h");
});

test("a stale block fogs an item that has no stamp of its own", () => {
	const now = Date.parse("2026-01-20T12:00:00Z");
	const block = { as_of: "2026-01-10T12:00:00Z", stale_after: 86400 };
	const f = freshness({}, block, "UTC", now);
	assert.equal(f.stale, true);
	assert.equal(chipText(f), "unknown · 10 d");
});

test("an item's own as_of beats its block's", () => {
	const now = Date.parse("2026-01-20T12:00:00Z");
	const block = { as_of: "2026-01-10T12:00:00Z", stale_after: 86400 };
	const f = freshness({ as_of: "2026-01-20T11:00:00Z" }, block, "UTC", now);
	assert.equal(f.stale, false);
	assert.equal(chipText(f), "1 h");
});

test("an item's own stale_after beats its block's", () => {
	const now = Date.parse("2026-01-10T14:00:00Z");
	const block = { as_of: "2026-01-10T12:00:00Z", stale_after: 86400 };
	assert.equal(freshness({ stale_after: 60 }, block, "UTC", now).stale, true);
});

test("no stale_after anywhere means never stale", () => {
	const now = Date.parse("2030-01-01T00:00:00Z");
	assert.equal(freshness({}, { as_of: "2026-01-10T12:00:00Z" }, "UTC", now).stale, false);
});

test("a YYYY-MM-DD date is end of day in the given zone", () => {
	// Rome is UTC+1 in January: 23:59:59 local is 22:59:59Z.
	assert.equal(asOfToMs("2026-01-10", "Europe/Rome"), Date.parse("2026-01-10T22:59:59Z"));
	// UTC+2 in summer (CEST): 21:59:59Z.
	assert.equal(asOfToMs("2026-07-10", "Europe/Rome"), Date.parse("2026-07-10T21:59:59Z"));
	// West of UTC: New York in January is UTC-5, so 04:59:59Z the next day.
	assert.equal(asOfToMs("2026-01-10", "America/New_York"), Date.parse("2026-01-11T04:59:59Z"));
	// The DST change day itself (Rome springs forward 2026-03-29, ending at UTC+2).
	assert.equal(asOfToMs("2026-03-29", "Europe/Rome"), Date.parse("2026-03-29T21:59:59Z"));
});

test("a date-only as_of is still fresh during its own day", () => {
	const now = Date.parse("2026-01-10T22:00:00Z"); // 23:00 in Rome
	const f = freshness({ as_of: "2026-01-10", stale_after: 0 }, { as_of: "2026-01-01" }, "Europe/Rome", now);
	assert.equal(f.stale, false);
	assert.equal(chipText(f), "0 m");
});

test("age chip formatting", () => {
	assert.equal(formatAge(0), "0 m");
	assert.equal(formatAge(45 * 60000), "45 m");
	assert.equal(formatAge(59 * 60000 + 59000), "59 m");
	assert.equal(formatAge(H), "1 h");
	assert.equal(formatAge(3 * H + 20 * 60000), "3 h");
	assert.equal(formatAge(47 * H + 59 * 60000), "47 h");
	assert.equal(formatAge(2 * D), "2 d");
	assert.equal(formatAge(12 * D + 5 * H), "12 d");
	assert.equal(formatAge(-5000), "0 m");
});

test("an as_of up to an hour in the future counts as age zero", () => {
	const now = Date.parse("2026-01-10T12:00:00Z");
	const f = freshness(undefined, { as_of: "2026-01-10T12:59:00Z", stale_after: 1 }, "UTC", now);
	assert.deepEqual(f, { ageMs: 0, stale: false });
});

test("an item as_of more than an hour in the future is fogged", () => {
	const now = Date.parse("2026-01-10T12:00:00Z");
	const block = { as_of: "2026-01-10T11:00:00Z", stale_after: 86400 };
	const f = freshness({ as_of: "2026-01-10T13:01:00Z" }, block, "UTC", now);
	assert.deepEqual(f, { ageMs: null, stale: true });
	assert.equal(chipText(f), "unknown");
	// A date-only stamp for tomorrow is far ahead; today's date at noon is not.
	assert.equal(freshness({ as_of: "2026-01-11" }, block, "UTC", now).stale, true);
	assert.deepEqual(freshness({ as_of: "2026-01-10" }, block, "UTC", now), { ageMs: 0, stale: false });
	// Tomorrow's date counts as ahead only until the last hour before its midnight.
	assert.equal(freshness({ as_of: "2026-01-11" }, block, "UTC", Date.parse("2026-01-10T23:30:00Z")).stale, false);
});

test("a board written more than an hour in the future is stale", () => {
	const r = parseBoard(board([], { written_at: "2026-01-10T14:00:00Z" }));
	const soon = Date.parse("2026-01-10T13:30:00Z");
	const early = Date.parse("2026-01-10T12:30:00Z");
	assert.equal(boardFromFuture(r.board, soon), false);
	assert.equal(boardStale(r.board, soon), false);
	assert.equal(boardFromFuture(r.board, early), true);
	assert.equal(boardStale(r.board, early), true); // no stale_after needed
});

test("impossible dates are unreadable, not rolled over", () => {
	for (const s of ["2026-02-30", "2026-13-45", "2026-00-10", "2025-02-29", "2026-02-30T10:00:00Z", "2026-13-01T00:00:00Z"]) {
		assert.ok(Number.isNaN(asOfToMs(s, "UTC")), s);
		assert.equal(chipText(freshness({ as_of: s }, { as_of: "2026-01-10" }, "UTC", Date.now())), "unknown", s);
	}
	assert.equal(asOfToMs("2028-02-29", "UTC"), Date.parse("2028-02-29T23:59:59Z")); // a real leap day
	assert.equal(parseBoard(board([], { written_at: "2026-02-30T12:00:00Z" })).reason, "format");
});

test("a leading byte-order mark is ignored", () => {
	const r = parseBoard("﻿" + board([]));
	assert.equal(r.ok, true);
});

test("a huge spark is capped to the newest points and its bounds never throw", () => {
	const start = Date.parse("2020-01-01T00:00:00Z");
	const n = 300000;
	const points = [];
	for (let i = 0; i < n; i++) points.push([new Date(start + i * 60000).toISOString(), i]);
	const r = parseBoard(board([{ id: "s", kind: "spark", title: "S", as_of: "2026-01-10", value: "1", points }]));
	const kept = r.board.blocks[0].points;
	assert.equal(kept.length, MAX_POINTS);
	assert.equal(kept[0][1], n - MAX_POINTS);
	assert.equal(kept[kept.length - 1][1], n - 1);
	// The bounds loop handles far more than the cap without a RangeError.
	const big = points.map((p, i) => [start + i, i]);
	assert.deepEqual(sparkBounds(big), { t0: start, t1: start + n - 1, v0: 0, v1: n - 1 });
});

test("block ids become a sanitised class", () => {
	assert.equal(blockIdClass("money"), "qb-block-id-money");
	assert.equal(blockIdClass("Feeds_2 x/y"), "qb-block-id-feeds-2-x-y");
	assert.equal(blockIdClass("#3"), "qb-block-id--3");
});

test("an unreadable as_of is fogged with a bare unknown chip", () => {
	const f = freshness({ as_of: "yesterday" }, { as_of: "2026-01-10T12:00:00Z" }, "UTC", Date.now());
	assert.equal(f.stale, true);
	assert.equal(chipText(f), "unknown");
});

test("an unknown block kind becomes a note, not a crash", () => {
	const r = parseBoard(board([{ id: "x", kind: "pie", title: "Pie", as_of: "2026-01-10" }]));
	assert.equal(r.ok, true);
	assert.deepEqual(r.board.blocks[0], { kind: "note", id: "x", title: "Pie", message: "unknown block kind" });
});

test("a block with no as_of is a format error for that block only", () => {
	const r = parseBoard(
		board([
			{ id: "a", kind: "lines", title: "A", items: [] },
			{ id: "b", kind: "lines", title: "B", as_of: "2026-01-10", items: [{ text: "hi" }] },
		]),
	);
	assert.equal(r.ok, true);
	assert.equal(r.board.blocks[0].kind, "note");
	assert.equal(r.board.blocks[0].message, "block has no as_of");
	assert.equal(r.board.blocks[1].kind, "lines");
	assert.equal(r.board.blocks[1].items[0].tone, "neutral");
});

test("a wrong spec is refused plainly", () => {
	const r = parseBoard(JSON.stringify({ spec: "quiet-board/2", written_at: "2026-01-10T12:00:00Z", blocks: [] }));
	assert.equal(r.ok, false);
	assert.equal(r.reason, "spec");
	assert.match(r.message, /quiet-board\/2/);
	assert.equal(parseBoard(JSON.stringify({ written_at: "2026-01-10T12:00:00Z", blocks: [] })).reason, "spec");
});

test("a half-written file returns a parse failure instead of throwing", () => {
	const full = board([{ id: "a", kind: "lines", title: "A", as_of: "2026-01-10", items: [] }]);
	for (const cut of [0, 1, 20, full.length - 1]) {
		const r = parseBoard(full.slice(0, cut));
		assert.equal(r.ok, false);
		assert.equal(r.reason, "json");
	}
});

test("missing written_at or blocks is a format failure", () => {
	assert.equal(parseBoard(JSON.stringify({ spec: "quiet-board/1", blocks: [] })).reason, "format");
	assert.equal(parseBoard(JSON.stringify({ spec: "quiet-board/1", written_at: "2026-01-10T12:00:00Z" })).reason, "format");
	assert.equal(parseBoard("[]").reason, "format");
	assert.equal(parseBoard("null").reason, "format");
});

test("an empty blocks array is a valid board", () => {
	const r = parseBoard(board([]));
	assert.equal(r.ok, true);
	assert.equal(r.board.blocks.length, 0);
});

test("spark points keep only well-formed pairs", () => {
	const r = parseBoard(
		board([
			{
				id: "s", kind: "spark", title: "S", as_of: "2026-01-10", value: "1", tone: "up",
				points: [["2026-01-01T00:00:00Z", 1], ["bad", 2], ["2026-01-02T00:00:00Z", "3"], ["2026-01-03T00:00:00Z", 4]],
			},
		]),
	);
	assert.deepEqual(r.board.blocks[0].points.map((p) => p[1]), [1, 4]);
});

test("an unknown tone falls back to neutral and an invalid tz to the machine zone", () => {
	const r = parseBoard(
		board([{ id: "a", kind: "lines", title: "A", as_of: "2026-01-10", items: [{ text: "x", tone: "purple" }] }], {
			tz: "Mars/Olympus",
		}),
	);
	assert.equal(r.board.blocks[0].items[0].tone, "neutral");
	assert.equal(r.board.tz, undefined);
});

test("written time shows a clock today and a date otherwise, and board staleness", () => {
	const written = Date.parse("2026-01-10T18:12:00Z");
	assert.equal(formatClock(written, "Europe/Rome", Date.parse("2026-01-10T20:12:00Z")), "19:12");
	assert.equal(formatClock(written, "Europe/Rome", Date.parse("2026-01-12T20:12:00Z")), "2026-01-10 19:12");
	const r = parseBoard(board([], { stale_after: 3600 }));
	assert.equal(boardStale(r.board, Date.parse("2026-01-10T12:30:00Z")), false);
	assert.equal(boardStale(r.board, Date.parse("2026-01-10T13:30:00Z")), true);
});
