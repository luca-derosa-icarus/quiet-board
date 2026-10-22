# Quiet Board

An Obsidian plugin that draws a calm, read-only dashboard from a `.board` file. A script you own writes the file; the plugin only reads it. Click a `.board` file and it opens as a board in its own tab, and when the script rewrites the file, the open board redraws.

The plugin never fetches anything and never polls. A one-minute timer only updates the age chips and the fog from the data it already read.

Desktop only.

## What it shows

- A header with the board's title and when it was written (`written 19:12 · 2 h ago`), in the board's time zone.
- Blocks of three kinds: `cards` (labelled figures in a responsive grid), `lines` (short text rows), and `spark` (a wide, thin line of recent values with the latest value beside it).
- An age chip on every block and item. Anything older than its `stale_after` is fogged: drawn grey, without its colour, with a chip like `unknown · 3 h`. Old numbers stop looking like news.
- Colour only on the figure that carries a tone: green for up, red for down, orange for warn. No colour on panels.
- If the file can't be read (half written, broken), the plugin keeps the last good board, fogs all of it, and says so in one line.

See [`examples/desk.board`](examples/desk.board) for a complete sample with invented figures.

## File format, `quiet-board/1`

A `.board` file is UTF-8 JSON. Write it atomically (write a temporary file, then rename it over the old one) so the plugin never sees half a file.

```json
{
  "spec": "quiet-board/1",
  "title": "Example desk",
  "written_at": "2026-01-15T17:12:00Z",
  "stale_after": 172800,
  "tz": "Europe/Rome",
  "blocks": [
    {"id": "balances", "kind": "cards", "title": "Balances",
     "as_of": "2026-01-15T17:12:00Z", "stale_after": 604800,
     "items": [{"label": "Available", "value": "EUR 2,500.00", "delta": "-80.00 due by 01-31", "tone": "down"}]},
    {"id": "trend", "kind": "spark", "title": "Portfolio value",
     "as_of": "2026-01-15T17:00:00Z", "value": "EUR 5,432.10", "delta": "+21.40", "tone": "up",
     "points": [["2026-01-13T17:00:00Z", 5410.7], ["2026-01-15T17:00:00Z", 5432.1]]},
    {"id": "news", "kind": "lines", "title": "Since the last board",
     "as_of": "2026-01-15T17:05:00Z", "stale_after": 86400,
     "items": [{"text": "EXMPL +4.1% on volume", "tone": "up"}], "empty": "nothing moved"}
  ]
}
```

### Top level

| Field | Required | Meaning |
|---|---|---|
| `spec` | yes | Must be `quiet-board/1`. Anything else is refused with a plain message. |
| `title` | no | Shown in the header. Defaults to the file name. |
| `written_at` | yes | ISO time with a zone (`Z` or `+hh:mm`). |
| `stale_after` | no | Seconds. When the board is older than this, it is drawn dimmed with a note. |
| `tz` | no | IANA zone name. Every time shown is in it. Defaults to the machine's zone; an unknown name also falls back to it. |
| `blocks` | yes | Array of blocks; may be empty. |

### Every block

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique string. |
| `kind` | yes | `cards`, `lines` or `spark`. An unknown kind is drawn as a one-line note, never a crash. |
| `title` | no | Block heading. |
| `as_of` | yes | ISO time with a zone, or a `YYYY-MM-DD` date. A block without it is shown as a format-error note. |
| `stale_after` | no | Seconds. Absent means never stale. |

- `cards`: `items` of `{label, value, note?, delta?, as_of?, stale_after?, tone?}`.
- `lines`: `items` of `{text, tone?, as_of?, stale_after?}`, plus optional `empty`, the text shown when `items` is empty.
- `spark`: `points` (array of `[ISO time, number]`, oldest first, up to about 60), `value`, `delta?`, `tone?`. Only the newest 500 points are kept; the rest are ignored.

### Tone and freshness

- `tone` is `neutral` (default), `up`, `down`, `warn` or `muted`. On a card or spark with a `delta`, the tone colours the delta; without a delta it colours the value. On a line it colours the text. An unknown tone is treated as `neutral`.
- Grey means fogged and nothing else. Fog alone uses Obsidian's faint text colour; `muted`, notes, labels and fresh age chips use the muted text colour, which stays readable and never looks fogged.
- An item's own `as_of` and `stale_after` win over its block's, field by field.
- A `YYYY-MM-DD` date counts as 23:59:59 of that day in `tz`. An impossible date (`2026-02-30`, `2026-13-45`), in a date or a datetime, is unreadable.
- Ages read `45 m` under an hour, `3 h` under two days, and `12 d` beyond.
- A stale or unreadable stamp fogs the item: grey, no tone, chip `unknown · <age>` (or just `unknown` when the stamp can't be read).
- A stamp more than an hour in the future (for a date, its day starting more than an hour from now) is fogged with the chip `unknown`. A board whose `written_at` is more than an hour in the future is drawn as stale, with a note that the writer's clock may be wrong.
- A leading UTF-8 byte-order mark is ignored.

### Styling one block

Each block's element carries the class `qb-block-id-<id>`, with the id lower-cased and every character outside `a-z`, `0-9` and `-` turned into `-`. A CSS snippet in your vault can restyle one block without a format change:

```css
.qb-block-id-news .qb-line-text { font-size: var(--font-ui-small); }
```

## Build

```sh
npm install
npm run build      # type-checks, then bundles src/ into main.js
npm test           # Node's built-in test runner over the pure logic in src/board.ts
```

The tests load the TypeScript module directly, which needs a Node with built-in type stripping (22.18+ or 23.6+; developed on 24.19).

## Install into a vault

```sh
npm run install-vault -- /path/to/your/vault
```

This copies `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/quiet-board/`. It does not enable the plugin: turn it on yourself in **Settings → Community plugins**.

## Versions

- The plugin version (in `manifest.json`, `package.json` and `versions.json`) gets a patch bump on every build that is committed. It stays at 0.1.0 until the first release.
- The file format stays `quiet-board/1` when it gains a new optional field. Only a breaking change becomes `quiet-board/2`.

## Licence

MIT. See [`LICENSE`](LICENSE).
