import { FileView, TFile, TAbstractFile, WorkspaceLeaf } from "obsidian";
import {
	Block,
	Board,
	CardsBlock,
	Freshness,
	LinesBlock,
	SparkBlock,
	Tone,
	blockIdClass,
	boardFromFuture,
	boardStale,
	chipText,
	formatAge,
	formatClock,
	freshness,
	parseBoard,
	sparkBounds,
} from "./board";

export const VIEW_TYPE_BOARD = "quiet-board-view";

const TICK_MS = 60 * 1000;

interface ReadError {
	atMs: number;
	reason: "json" | "spec" | "format" | "io";
	message: string;
}

/**
 * Read-only view of a `.board` file. A FileView rather than a TextFileView,
 * so Obsidian never tries to save the file back. The file is re-read when the
 * vault reports it modified (or re-created); a one-minute timer only redraws
 * ages and fog from the data already read.
 */
export class BoardView extends FileView {
	private lastGood: Board | null = null;
	private error: ReadError | null = null;
	private readSeq = 0;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_BOARD;
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Quiet Board";
	}

	canAcceptExtension(extension: string): boolean {
		return extension === "board";
	}

	onload(): void {
		super.onload();
		const onChange = (f: TAbstractFile) => {
			if (this.file && f instanceof TFile && f.path === this.file.path) void this.reload();
		};
		this.registerEvent(this.app.vault.on("modify", onChange));
		this.registerEvent(this.app.vault.on("create", onChange));
		this.registerInterval(window.setInterval(() => this.draw(), TICK_MS));
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.lastGood = null;
		this.error = null;
		await this.reload();
	}

	async onUnloadFile(file: TFile): Promise<void> {
		this.readSeq++;
		this.lastGood = null;
		this.error = null;
		this.contentEl.empty();
	}

	private async reload(): Promise<void> {
		const file = this.file;
		if (!file) return;
		const seq = ++this.readSeq;
		let text: string;
		try {
			text = await this.app.vault.read(file);
		} catch (e) {
			if (seq !== this.readSeq) return;
			this.error = { atMs: Date.now(), reason: "io", message: e instanceof Error ? e.message : String(e) };
			this.draw();
			return;
		}
		if (seq !== this.readSeq) return; // a newer read has started
		const result = parseBoard(text);
		if (result.ok) {
			this.lastGood = result.board;
			this.error = null;
		} else {
			this.error = { atMs: Date.now(), reason: result.reason, message: result.message };
		}
		this.draw();
	}

	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const root = el.createDiv({ cls: "qb-board" });
		const now = Date.now();
		const board = this.lastGood;
		const name = this.file?.name ?? "the file";

		if (this.error) {
			const at = formatClock(this.error.atMs, board?.tz, now);
			const lead =
				this.error.reason === "spec"
					? `${name}: ${this.error.message}`
					: `couldn't read ${name} at ${at}`;
			const tail = board ? "; showing the last good board" : "";
			root.createDiv({ cls: "qb-error", text: lead + tail });
		}
		if (!board) return;

		const forceFog = this.error !== null;
		const stale = boardStale(board, now);
		const future = boardFromFuture(board, now);
		const body = root.createDiv({ cls: stale ? "qb-body qb-dimmed" : "qb-body" });

		const header = body.createDiv({ cls: "qb-header" });
		header.createEl("h2", { cls: "qb-title", text: board.title || this.getDisplayText() });
		const written = formatClock(board.writtenMs, board.tz, now);
		const when = future ? "in the future" : `${formatAge(Math.max(0, now - board.writtenMs))} ago`;
		header.createDiv({ cls: "qb-written", text: `written ${written} · ${when}` });
		if (future) {
			body.createDiv({ cls: "qb-stale-note", text: "This board is stamped in the future; the writer's clock may be wrong." });
		} else if (stale) {
			body.createDiv({ cls: "qb-stale-note", text: "This board is older than its stale_after; its writer may have stopped." });
		}

		if (board.blocks.length === 0) {
			body.createDiv({ cls: "qb-muted", text: "No blocks." });
		}
		for (const block of board.blocks) this.drawBlock(body, block, board, now, forceFog);
	}

	private drawBlock(parent: HTMLElement, block: Block, board: Board, now: number, forceFog: boolean): void {
		const section = parent.createDiv({ cls: `qb-block qb-block-${block.kind} ${blockIdClass(block.id)}` });
		const head = section.createDiv({ cls: "qb-block-head" });
		head.createDiv({ cls: "qb-block-title", text: block.title || block.id });

		if (block.kind === "note") {
			section.createDiv({ cls: "qb-note", text: block.message });
			return;
		}
		const bf = freshness(undefined, block, board.tz, now, forceFog);
		chip(head, bf);

		if (block.kind === "cards") this.drawCards(section, block, board, now, forceFog);
		else if (block.kind === "lines") this.drawLines(section, block, board, now, forceFog);
		else this.drawSpark(section, block, bf);
	}

	private drawCards(section: HTMLElement, block: CardsBlock, board: Board, now: number, forceFog: boolean): void {
		const grid = section.createDiv({ cls: "qb-cards" });
		for (const item of block.items) {
			const f = freshness(item, block, board.tz, now, forceFog);
			const card = grid.createDiv({ cls: "qb-card" });
			const top = card.createDiv({ cls: "qb-card-top" });
			top.createDiv({ cls: "qb-label", text: item.label });
			chip(top, f);
			// The tone describes movement: it colours the delta when there is one,
			// otherwise the value.
			const valueTone = item.delta ? "neutral" : item.tone;
			card.createDiv({ cls: figureClasses("qb-value", valueTone, f), text: item.value });
			if (item.delta) card.createDiv({ cls: figureClasses("qb-delta", item.tone, f), text: item.delta });
			if (item.note) card.createDiv({ cls: "qb-card-note", text: item.note });
		}
		if (block.items.length === 0) section.createDiv({ cls: "qb-muted", text: "No items." });
	}

	private drawLines(section: HTMLElement, block: LinesBlock, board: Board, now: number, forceFog: boolean): void {
		if (block.items.length === 0) {
			section.createDiv({ cls: "qb-muted", text: block.empty ?? "Nothing here." });
			return;
		}
		const list = section.createDiv({ cls: "qb-lines" });
		for (const item of block.items) {
			const f = freshness(item, block, board.tz, now, forceFog);
			const row = list.createDiv({ cls: "qb-line" });
			row.createDiv({ cls: figureClasses("qb-line-text", item.tone, f), text: item.text });
			chip(row, f);
		}
	}

	private drawSpark(section: HTMLElement, block: SparkBlock, f: Freshness): void {
		const row = section.createDiv({ cls: "qb-spark" });
		const holder = row.createDiv({ cls: "qb-spark-line-holder" });
		drawSparkline(holder, block.points, f.stale);
		const side = row.createDiv({ cls: "qb-spark-side" });
		const valueTone = block.delta ? "neutral" : block.tone;
		side.createDiv({ cls: figureClasses("qb-value", valueTone, f), text: block.value });
		if (block.delta) side.createDiv({ cls: figureClasses("qb-delta", block.tone, f), text: block.delta });
	}
}

function chip(parent: HTMLElement, f: Freshness): void {
	parent.createDiv({ cls: f.stale ? "qb-chip qb-chip-fog" : "qb-chip", text: chipText(f) });
}

function figureClasses(base: string, tone: Tone, f: Freshness): string {
	if (f.stale) return `${base} qb-fog`;
	return tone === "neutral" ? base : `${base} qb-tone-${tone}`;
}

const SPARK_W = 100;
const SPARK_H = 24;
const SPARK_PAD = 2;

function drawSparkline(parent: HTMLElement, points: [number, number][], fogged: boolean): void {
	if (points.length === 0) {
		parent.createDiv({ cls: "qb-muted", text: "No points." });
		return;
	}
	const { t0, t1, v0, v1 } = sparkBounds(points);
	const vs0 = points[0][1];
	const x = (t: number) => (t1 === t0 ? SPARK_W : ((t - t0) / (t1 - t0)) * SPARK_W);
	const y = (v: number) =>
		v1 === v0 ? SPARK_H / 2 : SPARK_PAD + (1 - (v - v0) / (v1 - v0)) * (SPARK_H - 2 * SPARK_PAD);
	const coords =
		points.length === 1
			? `0,${y(vs0)} ${SPARK_W},${y(vs0)}`
			: points.map((p) => `${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(" ");

	const svg = parent.createSvg("svg", {
		cls: fogged ? "qb-sparkline qb-sparkline-fog" : "qb-sparkline",
		attr: { viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, preserveAspectRatio: "none", role: "img" },
	});
	svg.createSvg("title").textContent = `${points.length} points, ${v0} to ${v1}`;
	svg.createSvg("polyline", { attr: { points: coords, "vector-effect": "non-scaling-stroke" } });
}
