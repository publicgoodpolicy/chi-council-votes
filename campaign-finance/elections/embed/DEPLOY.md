# Elections embed — deploy

Three Squarespace **Code Blocks** (inline HTML, never an iframe — iframe content
doesn't count for the page's SEO), one per office, all from one codebase.

## What to paste

**One file per page**, each self-contained and paste-ready (data.js + render.js +
app.js inlined; Poppins via Google Fonts; Recoleta via the council embed's
`@font-face`). Regenerate all three after any source change:

```
cd campaign-finance/elections/embed
node tools/build_embed.js        # -> all three files below
```

| Page          | File                                        |
|---------------|---------------------------------------------|
| /school-board | `elections-embed.inlined.html`              |
| /city-council | `elections-embed.city-council.inlined.html` |
| /mayor        | `elections-embed.mayor.inlined.html`        |

The payload is byte-identical across the three; they differ only in the baked
`data-office` and in the paste instruction naming their page. Each file names its
page in the comment at the top — check it before pasting, because three ~194 KB
files that differ in two lines are easy to confuse.

## The three pages

Create three Squarespace pages, each with its own `<title>`/H1/meta, and on each
add a **Code Block** containing that page's file from the table above.

| Page          | `data-office`  | State now                                  |
|---------------|----------------|--------------------------------------------|
| /school-board | `school_board` | **Live** — 9 committees, IE layer, spend   |
| /city-council | `city_council` | Coming-soon (committees not yet mapped)    |
| /mayor        | `mayor`        | Coming-soon (committees not yet mapped)    |

`data-office` is **already baked into each file** (D-16 / PS-106, MUNI-ENABLE-1 G7)
— nothing in the pasted block is edited by hand. It used to be one file whose mount
attribute the paster edited per page; that step is retired.

`city_council` and `mayor` render a clean "coming soon — finance processing as
candidates file" state (not an error) until their candidate committees are mapped
in `race-map.json`.

## Data dependency (the CDN)

The embed fetches `election-data.json` at runtime from the GitHub raw CDN:

```
https://raw.githubusercontent.com/publicgoodpolicy/chi-council-votes/main/campaign-finance/election-data.json
```

That file **must be committed and pushed** (it is, as of the "publish" commit) for
the CDN to serve it. To refresh the data: re-run the election build (see
`README.md` run order), commit + push `election-data.json`, and the live embeds
pick it up on next load (no re-paste needed).

Override the source for testing with `data-src="..."` on the mount div, or
`window.IPG_DATA_URL`.

## Verify before pasting

```
cd campaign-finance/elections/embed
node tools/prerender_b2.js                       # data+render assertions (pure layers)
# live data reachable:
curl -sI https://raw.githubusercontent.com/publicgoodpolicy/chi-council-votes/main/campaign-finance/election-data.json | head -1
```
