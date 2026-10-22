// Copy the built plugin into a vault: npm run install-vault -- <vault folder>
// Writes only <vault>/.obsidian/plugins/quiet-board/{main.js,manifest.json,styles.css}.
// It never enables the plugin; turn it on in Settings > Community plugins.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vaultArg = process.argv[2];
if (!vaultArg) {
	console.error("usage: npm run install-vault -- <vault folder>");
	process.exit(1);
}
const vault = resolve(vaultArg);
const configDir = join(vault, ".obsidian");
if (!existsSync(configDir) || !statSync(configDir).isDirectory()) {
	console.error(`not an Obsidian vault (no .obsidian folder): ${vault}`);
	process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) {
	if (!existsSync(join(root, f))) {
		console.error(`missing ${f}; run npm run build first`);
		process.exit(1);
	}
}

const target = join(configDir, "plugins", "quiet-board");
mkdirSync(target, { recursive: true });
for (const f of files) {
	copyFileSync(join(root, f), join(target, f));
	console.log(`copied ${f} -> ${join(target, f)}`);
}
