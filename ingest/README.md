# PDF ingest pipeline

A one-off migration tool: 21 Energy Konnect issue PDFs (~1,385 pages) into
`Magazine` + `Article` + `ArticleContentBlock` rows, via the existing
admin API. **No server code was added or changed for this** — every endpoint it
calls already existed.

It lives inside `server/` deliberately, so it can import the real zod schemas
from `src/utils/blockSchemas.js`. A payload that validates here is a payload the
API accepts; there is no second copy of the schema to drift.

## What the corpus actually is

Each PDF is a whole magazine **issue**, not one article. Every one carries a
table of contents naming 5–10 articles under section headings that map exactly
onto `MagazineArticle.sectionLabel` — Editorial, Cover Story, Feature Article,
Tutorial, Consumer Desk, News and Events.

21 issues · 1,385 pages · ~497,000 words · **154 articles**.

All 21 have a real text layer. No OCR is needed anywhere.

## Setup

```bash
npm install
```

Then set these — in `server/.env`, or in `server/ingest/.env`, or as real
environment variables (which win over both):

| Variable                | Needed by   | Notes                                     |
| ----------------------- | ----------- | ----------------------------------------- |
| `ANTHROPIC_API_KEY`     | `structure` | The only stage that costs money. The PDF-mode track does not need it. |
| `INGEST_ADMIN_EMAIL`    | any load    | Must be an **ADMIN** account.             |
| `INGEST_ADMIN_PASSWORD` | any load    |                                           |
| `INGEST_PAPERS_DIR`     | `extract`   | Defaults to `E:/Aelyra Labs/Papers`.      |
| `INGEST_API_BASE`       | any load    | Defaults to `http://localhost:$PORT/api`. |
| `PDFTOTEXT_BIN`         | `extract`   | Only if auto-detection fails.             |

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

**5. `load`** — per issue: upload the source PDF → `POST /admin/magazines` →
`POST /admin/articles` per article → `POST /admin/magazines/:id/articles` to attach
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

---

# `publish` — going live, once

```bash
node ingest/run.js publish --dry
```

```bash
node ingest/run.js publish
```

Every loader here lands its work as DRAFT, because a migration that publishes as
it goes leaves no moment to look at the result. This is the other side of that
moment. It publishes **exactly what `out/ledger.json` records** and nothing else,
so the set it acts on is a file you can read first — `--dry` prints it.

An article's status and its issue's status are independent by design (§21, rule
18): publishing an issue does not publish its articles, and an article attached
to a draft issue stays out of the archive. Both halves are done, articles first.

Re-running is safe; anything already published is skipped rather than failed.
`--only <substring>` publishes one issue.

---

# The PDF-mode track

The block track above rebuilds an article as structured content. That is the
right thing for anything written from now on, and the wrong thing for a
back-catalogue: the pilot issue proved the text survives the conversion and the
magazine's design does not. It also needs `ANTHROPIC_API_KEY` and one model call
per six pages, for 154 articles.

This track keeps the printed page. Each article becomes a `contentMode: "PDF"`
article whose body is its own slice of the issue PDF, rendered in the reader's
PDF viewer. It reuses `extract` and `segment` unchanged — the same manifests,
the same issues, the same ledger — and replaces `structure`/`validate`/`load`
with two stages that call no model and cost nothing.

Metadata is identical either way. Title, author, category, section, issue and
summary are all real columns on `Article`, so listings, the magazine index,
search and comments do not know or care which kind an article is. `search_vector`
never indexed block content in the first place — it is built from title,
subtitle, summary, taxonomy and author — so a PDF article is exactly as findable
as a block one.

An issue can hold both. V1_I2's first five pieces were hand-structured as blocks
during the pilot and stayed that way; the rest of that issue is PDF.

## Running it

```bash
node ingest/run.js split
```

```bash
node ingest/run.js pdf-load --dry
```

```bash
node ingest/run.js pdf-load
```

`split` writes nothing to the network. Read `out/pdf-review.md` between the two.

## The stages

**3′. `split`** — cuts each manifest's page ranges into one PDF per article
under `out/pdfs/<issue>/NN.pdf` (pdf-lib, no native dependency), and writes
`out/pdfs/<issue>/plan.json` describing what `pdf-load` will create from each:
title, author, section, category, page range, summary.

The plan is a proposal, not a result. **`out/pdf-review.md` is the thing to
read** — one table per issue, with `!` against any article whose title or page
range needs a human. Editing `plan.json` is how you fix one. A re-run leaves an
existing plan alone; `--force` regenerates it and discards your edits.

Where the metadata comes from, and why it is not simply the manifest:

- **Titles** have two sources and neither is reliable throughout. The printed
  contents page is authoritative on Volume 1 issues 2–9 and unusable on the
  rest, where two columns interleave into `AAbboouuttEEnneerrggyy`. The
  article's own opening page is the reverse: clean from issue 10 onward, and
  unreadable on the early issues, which set the headline as a pull-quote that
  `-layout` glues onto the body line beside it. `lib/frontpage.js` reads the
  opening page, `lib/titles.js` picks between the two per article and reports
  every fallback. Caps headlines are recased, with the archive's acronyms named
  explicitly so `DRAFT NEP 2021` does not become `Draft Nep 2021`.
- **Authors** only exist on the opening page — the contents listing has never
  carried them. Where a byline is printed it is used; where none is, the author
  is the publication itself, `Energy Konnect`. 32 of 125 carry a real byline.
- **Categories** are keyword-scored from the title and first page
  (`lib/classify.js`), weighted 4:1 towards the title so that a tariff tutorial
  mentioning solar fifty times does not become a solar article. This is the
  least certain column and the cheapest to change: a dropdown in the CMS,
  against a title that is a slug. Close calls are listed per issue under a fold
  rather than flagged.
- **Summaries** are the article's own opening paragraph, taken only when it
  reads as clean prose. Optional everywhere else in the CMS, load-bearing here:
  it is the only body text `search_vector` will ever see.

`split` also repairs the manifest's own segmentation, because a scrambled
contents page does not only mangle titles — it invents entries. Anything with no
recoverable title, a duplicate of its neighbour's title, or a start page already
claimed is folded back into the article it continues rather than dropped, so no
page leaves the archive. Page 1 entries are the issue cover and are left out
(the cover is still in the issue's own PDF). Stage 2's 25-page cap is undone —
it exists to bound a model call, and nothing reads these.

154 manifest entries resolve to **125 articles** this way, 3 of them flagged.

**4′. `pdf-load`** — per issue: upload the whole issue PDF → `POST /admin/magazines`
→ per article, upload its slice → `POST /admin/articles` with
`contentMode: "PDF"`, `pdfMediaId`, `pdfPageCount` and `blocks: []` →
`POST /admin/magazines/:id/articles` to attach with `sectionLabel` and
`displayOrder`.

Same ledger, same idempotency, same DRAFT landing state as `load`. Each article
PDF's media id is recorded before the article is created, so a crash between the
two costs one orphaned media row rather than a duplicate upload on the next run.

## Known limits

- **Raw PDF URLs are not gated.** With `STORAGE_PROVIDER=local`, `/uploads/<key>`
  is served by `express.static` with no auth, while the free-article limit is
  enforced only on the article fetch. Anyone who opens a PDF article once has a
  permanent shareable link that bypasses it — and for a magazine the PDF *is*
  the product. Keys are random UUIDs, so this is a sharing leak, not a scraping
  hole. The fix is a `GET /api/articles/:slug/pdf` route reusing `optionalAuth`
  + `guestLimit`, which **must** honour HTTP `Range`: pdf.js streams pages with
  range requests rather than pulling the whole file.
- **`volume-2-micro-grid`'s contents page is unrecoverable.** Its 7 entries
  resolve to 2 articles. The page ranges in its `plan.json` are the ones worth
  checking by hand.
- **Figures, tables and photographs are all present**, which is the point — but
  they are inside the PDF, not in the media library, and cannot be reused as
  cover images or reordered.

---

# The DOCX track

A second front end onto the same pipeline, for issues that have been converted
to `.docx` first. It replaces stages 1–3 (`extract`, `segment`, `structure`),
reuses `validate` **unchanged**, and loads through its own `docx-load`.

**One document is one Article.** A converted issue becomes a single standalone
article carrying the whole magazine — not a `Magazine` with a row per
piece, which is what the PDF track above produces. The magazine's own structure
survives inside the article as headings.

Do **not** run `load` against a DOCX issue. That command builds the PDF track's
shape: it would create a `Magazine` and an article per piece.

## Why it exists

Two things the PDF track cannot do:

- **Figures and photographs.** `pdftotext` cannot see them, so the PDF track
  imports none. A `.docx` carries them in `word/media/`, in position.
- **Structure without a model.** `pdftotext` gives lines; deciding which line is
  a heading, which is a list item, and where a table starts costs an
  `ANTHROPIC_API_KEY` and a call per chunk. Word already recorded all of it:

  | Word says                          | becomes                             |
  | ---------------------------------- | ----------------------------------- |
  | `w:pStyle` = `Heading1`–`Heading4` | `heading` at that level             |
  | `w:numPr` + `numbering.xml`        | `list`, `ordered` or `unordered`    |
  | `w:tbl`                            | `table`                             |
  | `w:drawing` / `w:pict`             | `image`, where it sits in the prose |
  | `TOC1`/`TOC2`                      | dropped                             |

  So `docx-blocks` is a mapping, not an inference, and it is free.

The conversion is not lossless, and the track is built around what it loses —
see **What the conversion breaks** below.

## Setup

Put the `.docx` files under `INGEST_DOCX_DIR` (default
`E:/Aelyra Labs/Papers/docx`), **mirroring the volume folders** of
`INGEST_PAPERS_DIR`:

```
E:/Aelyra Labs/Papers/docx/Volume 1/V1 the electricity amendment bill.docx
```

That layout is load-bearing. `issueKeyFor()` derives the key from
`<parent folder>--<basename>`, so a `.docx` beside its PDF's volume folder
resolves to the same `issueKey` — and therefore shares the manifest, the ledger
entry and the `out/structured/` directory. Drop it in a flat folder and it
becomes a different issue.

`INGEST_ADMIN_EMAIL` / `INGEST_ADMIN_PASSWORD` are needed from `docx-media`
onward. No `ANTHROPIC_API_KEY` is needed at any point.

## Running it

The PDF track's `extract` and `segment` still run first: the DOCX track reads
their manifest for the article list.

```bash
node ingest/run.js docx-extract --only <substring>
```

```bash
node ingest/run.js docx-blocks --only <substring>
```

```bash
node ingest/run.js docx-media --only <substring>
```

```bash
node ingest/run.js validate --only <substring>
```

```bash
node ingest/run.js docx-load --only <substring>
```

## The stages

**1. `docx-extract`** — unzips the document (`lib/docx.js`, a ~50-line central
directory reader over `node:zlib`; `ingest/` carries no dependencies of its own)
and walks `word/document.xml` in order. Writes to `out/docx/<issueKey>/`:

- `flow.json` — one typed element per body `w:p`/`w:tbl`, plus a media
  inventory measured with `image-size`
- `media/` — `word/media/*` verbatim
- `segments.json` — a **proposed** manifest-article → element-range mapping
- `review.md` — everything it could not settle

Segmentation does not re-derive the article list. The manifest's titles and
section labels were already read off the printed contents page and reviewed by a
human; the only new question is where each starts in the DOCX, answered by
matching those titles against Word's headings. A title that does not match well
enough gets `startElement: null` and a line in `review.md` — **it is never
guessed**. Edit `segments.json` by hand and re-run `docx-blocks`;
`docx-extract --force` regenerates it and discards those edits.

**2. `docx-blocks`** — `flow.json` + `segments.json` → a single `draft/00.json`.
Offline and free. Alongside the plain mapping it drops empty spacing paragraphs,
drops images marked unusable, folds the tutorial articles' margin summaries into
`callout` blocks, and applies the repairs below.

Each piece is built separately — so every repair still sees one piece's prose,
not the whole issue — and the results are then assembled into one block
sequence:

```
heading 2   "Contents"
list        one line per piece, "<Section> — <Title>"
heading 2   section banner, only where the section changes
heading 3   piece title
…           that piece's blocks, its own headings clamped to level 4+
reference   every citation in the issue, gathered at the end
```

The contents list is built from `segments.json`, **not** from the printed
contents page. That page is there, in elements 6–22, but the conversion wrapped
its titles mid-phrase and glued the folio onto each ("Highlights on electricity
supply code regulations" / "published by WBERC5"). The segments carry the same
entries already spelled correctly and already reviewed.

References are pulled out of each piece and re-emitted once at the end. Left
where they fell, a footnote becomes a "References" heading stranded two thirds
of the way down a single page.

A section whose only piece carries the section's own name — Editorial — prints
its heading once, not twice.

Adverts, the masthead, the subscription panel and the colophon never appear:
only the element ranges named in `segments.json` are read.

One deliberate difference from `out/structured/`: `image` blocks here carry
`content.ref` (`"image12.jpeg"`), not `content.mediaId`. Nothing is uploaded
yet, so no uuid exists, and a draft would fail `blocksArraySchema`. That is
exactly why drafts live here.

**3. A human, or a model, fills in the rest.** `title`, `authorName`,
`categoryName`, `summary`, and any split the repairs refused. A whole issue has
no single author or category, so none of these can be read off the document —
the draft carries the bylines found inside it as a note to choose from.
`docx-media` refuses to proceed on a draft with an empty `authorName` or
`categoryName` rather than sending one the API would reject.

**4. `docx-media`** — uploads each referenced image through `POST /api/media`,
rewrites `ref` → `mediaId`, and writes `out/structured/<issueKey>/`. Only
referenced images are uploaded. Idempotent through the ledger under
`docx-image:<file>` keys, written after every upload.

**5. `validate`** — unchanged, and still the gate. It runs the payload through
`blocksArraySchema` imported from the server itself.

**6. `docx-load`** — creates the one article, as **DRAFT** with `contentMode:
BLOCKS`. Nothing else: no issue, no attachment. Idempotent through the ledger,
which records it under `articles[0]`.

Because there is no issue row there is nowhere to hang the source PDF, so a
DOCX-loaded issue does not appear on the magazine archive page and has no PDF
download. The article carries the whole issue as blocks instead.

## What the conversion breaks, and what is done about it

The magazine is set in two columns with drop caps and margin pull-quotes, and
the conversion loses the joins. Three shapes, handled in `docxBlocks.js`:

- **Drop caps.** The large initial letter becomes its own run, splitting the
  opening paragraph and stranding the letter on the front of the second half —
  `"ue to COVID 19, India declared…"` / `"Dits complete control…"`. An article
  whose first paragraph opens in lower case is never correct, so this is
  repaired: the capital goes back and the halves rejoin.
- **Column-break continuations.** `"…In some"` / `"cases, some abnormal amount
has also been claimed."` Joined when the second half opens in lower case, or
  when the first ends on a function word — no finished sentence ends on "by".
  Refused when the first half is under 40 characters, because a byline or a
  caption must not swallow the paragraph beneath it.
- **Everything else** stays split and stays listed in `review.md`.

Order matters: the drop-cap repair runs **before** the continuation joins. Run
the other way, the continuation pass welds the stranded half into the paragraph
above, and the still-lower-case opening then takes its initial off whatever
paragraph follows — `"Are you an electricity consumer?"` became
`"Lre you an electricity consumer?"` in exactly that way.

Two more, handled quietly:

- **`mc:AlternateContent`.** Every floating picture and text box is written
  twice — an `mc:Choice` with DrawingML and an `mc:Fallback` with the VML
  equivalent. Reading both counts every image twice and repeats every text box's
  prose. Only the Choice branch is read.
- **Page furniture as images.** The 18×27 hairlines that rule off a margin note
  are images too, at under 200 bytes. Anything under `INGEST_MIN_IMAGE_BYTES`
  (2048) or `INGEST_MIN_IMAGE_EDGE` (100px) is marked unusable at extract time
  and never reaches a block or the media library.

## Known limits

- **Hyperlinks are flattened.** The news roundup carries a few hundred; the
  `paragraph` block is plain text and only `reference` holds a URL. In-prose
  links become plain text. The `For details: https://…` lines survive as
  readable text.
- **Captions are inferred** from the paragraph after an image, when it is short
  enough to be one. Some will need an editor.
- **Section banners are not kept where Word put them.** `Heading1` in this
  layout is the printed section rule ("TUTORIAL", "CONSUMER"), which repeats on
  every page of a section. It is dropped during the per-piece build and
  re-emitted once per section by the assembly step.
- **One article is long.** This issue is 652 blocks and a 110 minute read, well
  inside the API's 2MB body limit at 176KB. The client renders every block, with
  no virtualisation; that is fine at this size but is the thing to watch if an
  issue is much larger.

## `resync` — landing a fix on articles that are already loaded

`load` is create-only: it skips anything the ledger records, which is what stops
a re-run duplicating rows. That leaves a trap, because fixes happen — a repair
rule improves, a summary gets rewritten, a segment boundary moves. Re-running
the earlier stages updates `out/structured/` and nothing else, so the files look
right while the database still holds the old text.

```bash
node ingest/run.js resync --only <substring> --dry
```

```bash
node ingest/run.js resync --only <substring>
```

It issues the same `PUT /admin/articles/:id` the CMS editor issues on save, so
the update gets the same validation, version bump and search-text rebuild.
Articles whose blocks already match are skipped, and anything that is not a
**DRAFT** is refused — editing a published article behind the reviewer's back is
not a migration's business.

This is not part of the normal run. Reach for it only after changing a stage
that has already been loaded from.
