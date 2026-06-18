# Elections embed — deploy

Three Squarespace **Code Blocks** (inline HTML, never an iframe — iframe content
doesn't count for the page's SEO), one per office, all from one codebase.

## What to paste

`elections-embed.inlined.html` is the self-contained, paste-ready block
(data.js + render.js + app.js inlined; Poppins via Google Fonts; Recoleta via the
council embed's `@font-face`). Regenerate it after any source change:

```
cd campaign-finance/elections/embed
node tools/build_embed.js        # -> elections-embed.inlined.html
```

## The three pages

Create three Squarespace pages, each with its own `<title>`/H1/meta, and on each
add a **Code Block** containing the inlined HTML. The only per-page difference is
the `data-office` attribute on the mount div:

| Page          | `data-office`  | State now                                  |
|---------------|----------------|--------------------------------------------|
| /school-board | `school_board` | **Live** — 9 committees, IE layer, spend   |
| /city-council | `city_council` | Coming-soon (committees not yet mapped)    |
| /mayor        | `mayor`        | Coming-soon (committees not yet mapped)    |

In the pasted block, set:

```html
<div id="ipg-elect-root" data-office="school_board"></div>   <!-- or city_council / mayor -->
```

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
