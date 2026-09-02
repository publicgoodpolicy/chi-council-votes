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
page in the comment at the top — check it before pasting, because three ~211 KB
files that differ in two lines are easy to confuse.

## The three pages

Create three Squarespace pages, each with its own `<title>`/H1/meta, and on each
add a **Code Block** containing that page's file from the table above.

| Page          | `data-office`  | State now                                  |
|---------------|----------------|--------------------------------------------|
| /school-board | `school_board` | **Live** — 9 committees, IE layer, spend   |
| /city-council | `city_council` | live — first paste at CNCL-DATA-1 P2.2      |
| /mayor        | `mayor`        | Coming-soon; page not created (R7, 2026-08-31) |

`data-office` is **already baked into each file** (D-16 / PS-106, MUNI-ENABLE-1 G7)
— nothing in the pasted block is edited by hand. It used to be one file whose mount
attribute the paster edited per page; that step is retired.

`mayor` renders a clean "coming soon — finance processing as candidates file"
state (not an error) until its candidate committees are mapped in `race-map.json`.
`city_council` is mapped and live (readiness TRUE, 50 wards, 86 of 87 committees
valued, as of the 2026-08-20 vintage).

## Paste record

What is live is the bytes that were pasted, verified by capture after the paste; the
record is the identity, not the date alone. Capture normalizes to exactly one trailing
newline (PS-98 as amended), which is why a capture measures one byte and one line
fewer than its packet.

| Page          | Pasted            | Packet sha256 (bytes / lines)                                                 | Post-paste capture sha256 (bytes / lines)                                     |
|---------------|-------------------|-------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| /school-board | 2026-08-31 (P2.2) | `f939c7cff90e409ea85a013584cd1d39bfb684b582e5b37bf5340dee6e595002` (211,194 / 3,195) | `1d12308bb594d0c73445613241aadb2088ad6b96496a93c7215b7cf4a61409d4` (211,193 / 3,194) |
| /city-council | 2026-08-31 (P2.2; page created that day) | `5dac3ec1c92e19c0d3c66800434ff85af31d90e4d1e99505ee0fc74cbd75072f` (211,194 / 3,195) | `f401d88dbe609e6998caae04b3eff6664a10c6e2e7078c75e21a0804777f0ca4` (211,193 / 3,194) |
| /mayor        | —                 | not created (R7, 2026-08-31)                                                  | —                                                                             |

A paste is owed only when the embed bundle's bytes change; data artifacts update on
push alone (next section).

## Ordering and the two deploy windows

The ratified ordering is R12's (`campaign-finance/RULINGS.md`, `CNCL-DATA-1 P2 — display
decisions`):
paste, verify the paste, then push — so the only window a reader can see is *new embed
on old artifacts*, which was measured defect-free at P2.2. How long that window lasts
after the push depends on the CDN edge, and both cases have been measured:

| Edge state at push                                   | Window to currency | Measured                                                                 |
|------------------------------------------------------|--------------------|--------------------------------------------------------------------------|
| Live cached entry for the path (fetched within 300 s)  | up to 300 s (`cache-control: max-age=300`) | P2.2, 2026-08-31: edge entry `expires: 03:44:13Z`; first current sample 03:48:46Z — a bracket, not 0 s |
| No cached entry (path not fetched recently)          | immediate (T0)     | PATHS-1/TOBON-1, 2026-09-01: current at the first sample, 17:12:55Z; the entry was created by that fetch |

Neither case is a guarantee: the window's length is set by whether an entry exists at
the edge, which is set by whether anyone fetched the path recently. Verify currency by
fetching the served artifact and comparing its sha256 to HEAD's, never by elapsed time.

## Data dependency (the CDN)

The embed fetches `election-data.json` at runtime from the GitHub raw CDN:

```
https://raw.githubusercontent.com/publicgoodpolicy/chi-council-votes/refs/heads/main/campaign-finance/election-data.json
```

That file **must be committed and pushed** (it is, as of the "publish" commit) for
the CDN to serve it. To refresh the data: re-run the election build (see
`campaign-finance/elections/README.md` run order), commit + push `election-data.json`, and the live embeds
pick it up on next load (no re-paste needed).

Override the source for testing with `data-src="..."` on the mount div, or
`window.IPG_DATA_URL`.

## Verify before pasting

```
cd campaign-finance/elections/embed
node tools/prerender_b2.js                       # data+render assertions (pure layers)
# live data reachable:
curl -sI https://raw.githubusercontent.com/publicgoodpolicy/chi-council-votes/refs/heads/main/campaign-finance/election-data.json | head -1
```
