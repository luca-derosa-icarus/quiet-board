import { Plugin } from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./view";

export default class QuietBoardPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(VIEW_TYPE_BOARD, (leaf) => new BoardView(leaf));
		this.registerExtensions(["board"], VIEW_TYPE_BOARD);
	}

	// Views registered with registerView are cleaned up by Obsidian; leaves are
	// deliberately not detached here, per the plugin guidelines.
	onunload(): void {}
}
