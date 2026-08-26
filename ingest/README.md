# PDF ingest pipeline

A one-off migration tool: 21 Energy Konnect issue PDFs (~1,385 pages) into
`PublicationIssue` + `Article` + `ArticleContentBlock` rows, via the existing
admin API. **No server code was added or changed for this** — every endpoint it
calls already existed.

It lives inside `server/` deliberately, so it can import the real zod schemas
from `src/utils/blockSchemas.js`. A payload that validates here is a payload the
API accepts; there is no second copy of the schema to drift.

## What the corpus actually is

Each PDF is a whole magazine **issue**, not one article. Every one carries a
table of contents naming 5–10 articles under section headings that map exactly
onto `IssueArticle.sectionLabel` — Editorial, Cover Story, Feature Article,
Tutorial, Consumer Desk, News and Events.

21 issues · 1,385 pages · ~497,000 words · **154 articles**.

All 21 have a real text layer. No OCR is needed anywhere.

## Setup

```bash
npm install
```

Then set these — in `server/.env`, or in `server/ingest/.env`, or as real
environment variables (which win over both):

| Variable | Needed by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `structure` | The only stage that costs money. |
| `INGEST_ADMIN_EMAIL` | `load` | Must be an **ADMIN** account. |
| `INGEST_ADMIN_PASSWORD` | `load` | |
| `INGEST_PAPERS_DIR` | `extract` | Defaults to `E:/Aelyra Labs/Papers`. |
| `INGEST_API_BASE` | `load` | Defaults to `http://localhost:$PORT/api`. |
| `PDFTOTEXT_BIN` | `extract` | Only if auto-detection fails. |

`pdftotext` must be on `PATH` or discoverable. On this machine it ships with
Git for Windows at `C:\Program Files\Git\mingw64\bin\pdftotext.exe`, which the
resolver already probes.

Optional tuning: `INGEST_MODEL` (default `claude-opus-5`), `INGEST_EFFORT`
(`medium`), `INGEST_CHUNK_PAGES` (`6`), `INGEST_CONCURRENCY` (`3`),
`INGEST_SEND_LAYOUT` (`1`).

## Running it

```bash
node ingest/run.js extract
```
```bash
node ingest/run.js segment
```
```bash
node ingest/run.js structure --dry
```
```bash
node ingest/run.js structure
```
```bash
node ingest/run.js validate
```
```bash
node ingest/run.js load --dry
```
```bash
node ingest/run.js load
```

`node ingest/run.js status` prints where every issue stands. Every command takes
`--only <substring>` to work on one issue.

## The stages

**1. `extract`** — `pdftotext` twice per PDF, into `out/raw/<issue>/`. Two
renderings are kept: `flow/` (reading-order — correct prose sequence across the
two-column layout, tables destroyed) and `layout/` (`-layout` — tables aligned,
marginal pull-quotes interleaved into body text). Neither is sufficient alone.

Pages are written **verbatim**. Running furniture is detected here and recorded
in `_meta.json`, but stripped later, in memory — the masthead and the printed
folios are furniture by every statistical measure and are also exactly the
signals stage 2 reads.

**2. `segment`** — writes one reviewable manifest per issue to
`out/manifests/`. Combines three signals: the cover line (volume/issue/period),
the table of contents (titles + printed start pages), and the printed folio in
each page margin (the offset between printed and PDF page numbers).

Every manifest carries `confidence` and `warnings`. **`review` does not mean
broken** — it means the three signals did not fully agree. Manifests are plain
JSON: edit `startPage`/`endPage`/`title`/`sectionLabel`, or set `skip: true`, and
re-run later stages. `segment --force` regenerates and discards your edits.

**3. `structure`** — the only stage that calls a model, and the only one that
costs money. Each article is sent in ~6-page chunks; both renderings of each
page go in the same call, and the model reconciles them into the block types the
API accepts.

Media blocks (`image`, `figure`) are deliberately excluded — both need a
`mediaId` for an already-uploaded asset. Where a figure appears the model emits
a `callout` titled "Figure" carrying its caption, so the position survives for a
later image pass.

Aggressively resumable: one file per article in `out/structured/`, skipped on
re-run unless `--force`. A crash on article 90 of 154 loses nothing.

**4. `validate`** — runs every payload through `blocksArraySchema` imported from
the server itself. Offline. A payload that fails here would have been a 400 and
a half-created article. Also reports quality warnings — no byline, no summary,
suspiciously little text, a paragraph duplicated across a chunk boundary.

**5. `load`** — per issue: upload the source PDF → `POST /admin/issues` →
`POST /admin/articles` per article → `POST /admin/issues/:id/articles` to attach
with `sectionLabel` and `displayOrder`.

Everything lands as **DRAFT**. Publishing is a human decision made in the CMS
after review.

Idempotent via `out/ledger.json`, written after every single create. Article
slugs are generated server-side and `uniqueSlug` appends `-2` on collision, so
re-POSTing would silently duplicate rather than fail — the ledger is the only
thing preventing that. Delete a ledger entry to force one item to be recreated.

## Known limits

- **Figures and photographs are not imported.** Text, tables and lists are.
  Figure positions are marked with `callout` blocks for a second pass.
- **Two issues have corrupted glyph mapping in the source PDF.** `micro grid.pdf`
  renders its TOC as `AAbboouuttEEnneerrggyy`; `sustainable energy development.pdf`
  shows two overlapping TOCs. Both are flagged `review` and need their manifests
  edited by hand.
- **`V1 the electricity amendment bill.pdf` has no issue number** anywhere in the
  file or its filename. Set `issueNumber` in its manifest before loading.
- **`V1_I14`'s cover reads "Volume 11 Issue 14"** — a typo in the source. The
  pipeline overrides it from the filename and says so in the warnings.
- **The last TOC entry inherits every remaining page**, which sweeps back matter
  ("Power & Energy, June 2020") into one long article. Anything over 25 pages is
  capped and flagged rather than silently sent to the model.
- **Refusal fallbacks are not enabled.** `messages.parse`-style structured output
  and the `fallbacks` beta live on different SDK paths; guaranteed schema
  conformance matters far more here than refusal rescue on energy-policy prose.
  A refusal fails that one chunk loudly and is retried on re-run.
