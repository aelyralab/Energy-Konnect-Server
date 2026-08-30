# Energy Konnect API

Backend for the Energy Konnect digital publication platform. See
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the full design —
schema, API surface, phased build order and the decisions behind them.

**Stack:** Node.js · Express (JavaScript, ESM) · Prisma · PostgreSQL (Neon) ·
Redis (Upstash, optional) · Cloudinary/local storage · Resend/console email

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:

- **`DATABASE_URL`** and **`DIRECT_URL`** — from your Neon project's
  Connection Details panel. `DATABASE_URL` is the pooled connection string
  (used by the running app); `DIRECT_URL` is the unpooled one (used only by
  `prisma migrate` — migrations fail against Neon's PgBouncer pooler).
- **`REDIS_URL`** — from Upstash, `rediss://...`. Optional: leave it blank
  and the API runs with caching and distributed rate limiting disabled
  (`/api/health` will report `redis: { status: "disabled" }`), everything
  else works normally.
- **`JWT_ACCESS_SECRET`** / **`COOKIE_SECRET`** — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

Every variable is validated at boot (`src/config/env.js`) — the process
exits with a readable report if something required is missing.

### 3. Run migrations

```bash
npm run prisma:migrate
```

This applies `prisma/migrations/`, including the hand-written migration that
adds the `search_vector` generated column and its GIN index (Prisma has no
`tsvector` type, so that one migration is SQL rather than schema.prisma —
see the comment in `prisma/migrations/20260821120100_article_search_vector/`).

### 4. Seed development data

```bash
npm run seed
```

Creates one account per role, the category/topic/tag taxonomy, both
magazines and three fully-populated published articles — all
ported from `client/src/data/*.js` so the seeded content matches what the
frontend prototype already renders. Idempotent — safe to re-run.

Printed at the end, sign-in credentials for all three seeded accounts
(password is the same for all three — development only):

| Role      | Email                       |
| --------- | --------------------------- |
| ADMIN     | admin@energykonnect.dev     |
| PUBLISHER | publisher@energykonnect.dev |
| USER      | reader@energykonnect.dev    |

### 5. Run the API

```bash
npm run dev
```

Starts on `http://localhost:4000` (or `$PORT`) with `node --watch`.
`GET /api/health` reports database and Redis status — `200` when the
database is reachable, `503` when it isn't (the process itself never
crashes on a database outage; see `src/config/db.js`).

### 6. Run the notification worker (optional, separate process)

```bash
npm run worker
```

Only needed if you want publication emails to actually get sent — the API
writes `PENDING` outbox rows itself (as part of the publish transaction),
but nothing sends them without this process polling and draining the
outbox. Safe to skip entirely for API-only development.

## Scripts

| Script                   | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `npm run dev`            | API with file watching                               |
| `npm start`              | API, no watching (production)                        |
| `npm run worker`         | Notification/email outbox worker (Phase 9)           |
| `npm run prisma:migrate` | Apply/create migrations (dev)                        |
| `npm run prisma:deploy`  | Apply migrations, no prompts (CI/production)         |
| `npm run prisma:studio`  | Prisma's data browser                                |
| `npm run seed`           | Run `prisma/seed.js`                                 |
| `npm run db:reset`       | Drop, recreate, migrate and reseed — **destructive** |
| `npm test`               | Run the test suite once                              |
| `npm run test:watch`     | Test suite in watch mode                             |
| `npm run lint`           | ESLint                                               |
| `npm run format`         | Prettier, write mode                                 |

## Project layout

```
src/
├── app.js            Express app (importable by tests without listening)
├── server.js         HTTP entrypoint — binds the port, owns graceful shutdown
├── worker.js          Notification/email outbox worker (Phase 9)
├── config/            env, db (Prisma), redis, logger
├── middleware/         auth, role, validation, error handling
├── modules/            one folder per resource: routes/controller/service/repository
├── jobs/               background job definitions
├── services/           email and storage provider adapters
├── utils/               jwt, password, otp, slug, pagination, ApiError, serializers
└── routes/index.js      mounts every module's routes under /api
```

Layering is enforced by convention, not tooling: controllers call services,
services call repositories, only repositories import Prisma. See
`IMPLEMENTATION_PLAN.md` §2 for the full rationale.

## Email

Three providers behind one interface (`src/services/email/index.js`), chosen
by `EMAIL_PROVIDER`:

- **`console`** (default) — logs the message, sends nothing. Zero setup.
- **`smtp`** — Gmail SMTP via nodemailer. Used in development for real inbox
  delivery. Needs a Google **App Password**, not your normal Gmail password
  (Google Account → Security → 2-Step Verification → App passwords).
- **`resend`** — the Resend HTTP API. **Required in production** — the server
  refuses to boot with `NODE_ENV=production` and any other provider, since
  Gmail SMTP has a ~500/day send cap and isn't meant for production traffic.

## Testing

```bash
npm test
```

Unit tests (`tests/unit/`) are pure functions — no I/O, run instantly.
Integration tests (`tests/integration/`) hit the live database configured in
`.env` (the same one `npm run seed` populates) and clean up after themselves.
Run `npm run seed` at least once before `npm test` — the integration suite
needs a seeded PUBLISHER and at least one category to exist.

## Current status

Phases 1–10 are complete and verified against a live Neon database:

- **Phase 1** — foundation: Express app, error handling, logging, health check.
- **Phase 2** — full Prisma schema, migrations, and a seed that ports real
  content from `client/src/data/*.js`.
- **Phase 3** — auth: register → OTP email → verify (auto-issues a session) →
  login → refresh (rotating, with reuse detection that revokes every session
  on replay) → logout, plus `/api/me` profile read/update/password change.
  Redis-backed rate limiting on register/login/verify/resend-otp, with an
  in-memory fallback when Redis is unavailable.
- **Phase 4** — public reads and taxonomy:
  - `GET /api/articles` (filter by category/topic/tag/issue/featured,
    paginated, PUBLISHED-only enforced in the repository) and
    `GET /api/articles/:slug` (full content in the context doc's §35 shape).
  - `GET /api/magazines` and `/api/magazines/:slug` — magazine archive,
    with the magazine's article list itself filtered to PUBLISHED articles
    (magazine status and article status stay independent, per rule 18).
  - `GET /api/categories` / `/api/topics` / `/api/tags` (public, Redis-cached
    with write-through invalidation) plus `/api/admin/{categories,topics,tags}`
    CRUD (ADMIN-only, slug frozen at creation, delete blocked while a term is
    still referenced by an article).
  - Server-side guest reading limit (`GuestRead` + a signed `ek_guest`
    cookie): a third _distinct_ published article returns 401
    `GUEST_LIMIT_REACHED`; re-reading an already-read article never counts,
    and signed-in readers are exempt entirely.
- **Phase 5** — article core and media:
  - `src/utils/blockSchemas.js` — a zod discriminated union validating all
    ten context-doc §14 block types; an unknown `blockType` or a `table`
    block whose row lengths don't match its column count is rejected before
    it ever reaches Postgres. Pinned by 25 unit tests
    (`tests/unit/blockSchemas.test.js`).
  - `articles.service.js#createArticle` — the reusable core the publisher and
    admin create-article endpoints (Phases 6–7) will both call: Article shell
    - ArticleVersion 1 + its blocks, committed as one transaction.
  - `articleVersions.service.js#saveContent` — replaces a version's metadata
    and blocks wholesale (delete-and-reinsert, so `blockOrder` can never end
    up with gaps or duplicates); refuses to touch a PUBLISHED/SUPERSEDED
    version. Both round-trip through 8 integration tests
    (`tests/integration/articleCore.test.js`) against the live database.
  - `POST /api/media` — shared upload endpoint for PUBLISHER/ADMIN, behind
    the same provider-adapter pattern as email (`local` disk in dev,
    `cloudinary` in production). MIME/size validated per type (images vs.
    PDF), image dimensions probed automatically.
- **Phase 6** — publisher workflow (`/api/publisher/articles/*`):
  create draft → edit → submit (context doc §26's required-fields gate,
  checked against whatever was last saved) → withdraw → resubmit after
  rejection, plus `revise` (§29: deep-copies a published version's metadata
  and blocks into a new pending version without touching the live one) and
  delete (never-published drafts only). Every mutation checks ownership in
  the service and returns 404, not 403, on someone else's article — a 403
  would itself confirm the article exists. 14 integration tests
  (`tests/integration/publisherWorkflow.test.js`) prove the two things that
  matter most: the public endpoint keeps serving the old version in full
  while a revision sits unreviewed, and publisher B gets 404 on publisher
  A's article at every one of these endpoints, verified with real inputs an
  attempted hijack would actually send. A submitted (PENDING_REVIEW) version
  is frozen — `withdraw` first re-opens it for editing, a correction to the
  original Phase 5 assumption that PENDING_REVIEW stayed editable.
- **Phase 7** — admin workflow:
  - **Article review** (`/api/admin/reviews`, `/api/admin/articles/*`):
    approve/reject the queue, direct-create-and-publish (§30 — admin skips
    review entirely), edit-a-published-article-directly (§31 — a fresh
    version, published in the same step, superseding the old one), and
    unpublish/archive (§32). Approve and direct-publish share one
    transactional core (`promoteToPublished`): version → PUBLISHED, the
    version it replaces → SUPERSEDED (never deleted), both Article pointers
    and its denormalized snapshot updated, an audit row written — all one
    commit. A caught-by-its-own-tests bug: the function's final read was
    issued through the global Prisma client from _inside_ the transaction
    callback, so it returned pre-commit data — every promotion looked like
    it silently failed until the read moved outside the transaction.
  - **Magazines** (`/api/admin/magazines/*`): CRUD, attach/reorder/detach
    articles with section labels, publish/archive. Publishing a magazine
    only ever changes the magazine row — verified directly against the
    public `/api/magazines/:slug` endpoint that a DRAFT and a
    PENDING_REVIEW article attached to a newly-published magazine stay
    exactly as invisible as before (§21, rule 18).
  - **Users** (`/api/admin/users`): the only path from `role: USER` to
    PUBLISHER/ADMIN. An admin can't self-demote or self-deactivate (no
    recovery path short of direct DB access); deactivating someone revokes
    their refresh tokens immediately, and role/active-status changes take
    effect on an already-issued access token's _next_ request, since
    `requireAuth` re-reads the user row from the database rather than
    trusting the token's embedded role claim.
  - 20 integration tests (`tests/integration/adminWorkflow.test.js`),
    including a real rollback test that engineers an actual Postgres unique-
    constraint collision (two articles can't share one `ArticleVersion` as
    their published version) and confirms every write inside the failed
    transaction — the version-status flip, the supersede, the pointer
    update — comes back exactly as it was before.
- **Phase 8** — comments (context doc §23–24): single-level, no replies, no
  reporting — `POST /api/comments` (any authenticated role, only on a
  PUBLISHED article), `GET /api/articles/:slug/comments` (public,
  chronological), `DELETE /api/comments/:id` (the comment's own author, or
  any ADMIN — one endpoint handles both, rather than a separate
  `/api/admin/comments/:id` that would do the identical thing). Deletion is
  soft (`isDeleted`), and a comment's `userId` FK uses `onDelete: Restrict`
  at the database level — not just an application convention — so an
  account with comments literally cannot be deleted, only deactivated. 10
  integration tests (`tests/integration/comments.test.js`) confirm the
  Phase 8 bar directly: deactivating a comment's author still returns the
  comment, content intact, with `author: null` in the serialized response.
- **Phase 9** — notifications (context doc §39–41): a transactional outbox,
  not a queue. Publishing an article/magazine writes `Notification` +
  `EmailNotification(status: PENDING)` rows in the _same transaction_ as the
  state change — a crash can't leave one without the other. `src/worker.js`
  (`npm run worker`) is a polling process, not a BullMQ consumer:
  IMPLEMENTATION_PLAN.md §0.4 explicitly allows this simplification, since
  Redis was only ever going to be a latency optimization and the outbox
  table is the real source of truth regardless. The claim step
  (`FOR UPDATE SKIP LOCKED`, one atomic `UPDATE ... RETURNING`) is what
  makes concurrent workers and crash recovery both safe.
  - **ARTICLE_PUBLISHED**/**ISSUE_PUBLISHED** broadcast to every active,
    opted-in user (`emailNotifications: true`) system-wide, excluding the
    article's own publisher; **ARTICLE_APPROVED**/**ARTICLE_REJECTED** go
    directly to the publisher and ignore that preference — telling someone
    the outcome of their own submission is transactional, not a "new
    publication" broadcast (§41's distinction).
  - Retry is the poll interval itself, not exponential backoff — sends
    fail-and-retry up to `EMAIL_OUTBOX_MAX_ATTEMPTS` (default 3), then the
    row is marked `FAILED` and left alone.
  - One-click unsubscribe (`GET /api/notifications/unsubscribe?token=`) —
    a signed HMAC token, no login required, since the click happens from
    inside an email client. Building this test caught a real bug in the
    token verifier: `Buffer.from(str, "hex")` silently truncates at the
    first non-hex character rather than throwing, so appending garbage to a
    valid signature didn't actually invalidate it — fixed by validating the
    signature is exactly 64 hex characters before ever comparing bytes.
  - 13 integration tests (`tests/integration/notifications.test.js`) prove
    the Phase 9 bar directly: 3 opted-in + 1 opted-out produces exactly 3
    `SENT` rows (scoped by recipient email, since a real broadcast also
    reaches every other opted-in account already in the database — the
    seeded users included — which the first version of this test learned
    the hard way), and a simulated crash-before-send (claim only, no send)
    is fully recovered by the next drain with no duplicate and no lost sends.
- **Phase 10** — PostgreSQL full-text search (context doc §42), properly
  weighted (title A / subtitle+summary B / taxonomy C / author D) rather
  than one flat unweighted blob — a deliberate improvement on the
  `search_vector` column Phase 2 first added (see the
  `20260822140000_search_vector_weighting` migration). Most of the weighted
  fields read straight off `Article`'s own columns via the generated column
  expression itself; only the taxonomy component (category name + topic
  names + tag names, which live in joined tables a generated column can't
  reach) is actively maintained, by `articles.service.js#refreshSearchText`,
  called everywhere the category or topic/tag associations can change
  (create, draft edits, and promotion to published).
  - `GET /api/search?q=...&category&topic&tag` — `websearch_to_tsquery`
    ranked by `ts_rank`, `ts_headline` snippets, `PUBLISHED`-only enforced
    in the query itself (same repository-level guarantee as every other
    public read since Phase 4). Two queries, not one: a raw ranked-ids
    query for the part Prisma can't express, then a normal `findMany` for
    full relational data — keeping the hand-written SQL surface to just the
    ranking math, reusing the same include shape and serializer as every
    other public article list.
  - 10 integration tests (`tests/integration/search.test.js`) prove the
    Phase 10 bar directly — searching "rooftop solar gujarat" against the
    seeded corpus returns the expected article first — plus that search
    respects publication status live (a fresh publish is found
    immediately, an unpublish removes it immediately, an edited category
    becomes searchable under its new name), and that a draft is never
    findable regardless of how exact the title match is.

- **Phase 11** — hardening, tests, docs. Closed the one real gap left in the
  suite: every prior phase's integration tests call service functions
  directly, so `requireAuth`/`requireRole`/zod `validate` had never actually
  been exercised as real HTTP middleware — `tests/integration/authorization.test.js`
  hits the exported `app.js` through supertest instead, proving rule 28
  ("authorization doesn't rely on frontend checks") and rule 29 (ownership)
  hold at the real route layer, not just in the service. Three more files —
  `authFlow.test.js`, `media.test.js`, `businessRules.test.js` — filled in
  automated coverage for auth/media/taxonomy rules that had been manually
  verified since Phases 3–5 but never pinned by a test. 135 tests across 11
  files, all green. [`API.md`](./API.md) documents every endpoint with
  example payloads; `IMPLEMENTATION_PLAN.md`'s Phase 11 section has the full
  §45-rule → test mapping table. No production Dockerfile — not needed for
  this deployment target.

All 11 phases are complete. See `IMPLEMENTATION_PLAN.md` for the full design
and phase-by-phase build notes.

## Deployment

This is a stateless Node process plus one optional background worker — no
in-process state survives a restart, so horizontal scaling is just running
more copies behind a load balancer.

**Environment.** Set every variable `src/config/env.js` requires (the process
validates them at boot and refuses to start otherwise — better a crash-loop
in your deploy logs than a silent misconfiguration in production):

- `NODE_ENV=production` — also the switch that **forbids** `EMAIL_PROVIDER=smtp`
  (Gmail's send cap isn't meant for production traffic; use `resend`).
- `DATABASE_URL` — pooled Neon connection string (PgBouncer). `DIRECT_URL` —
  unpooled, used only by migrations.
- `JWT_ACCESS_SECRET`, `COOKIE_SECRET` — generate fresh secrets per
  environment, never reuse the ones in `.env.example` or development:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- `CLIENT_ORIGIN` — the deployed frontend's origin, for CORS.
- `STORAGE_PROVIDER=cloudinary` (or your S3-compatible provider) — `local`
  disk storage doesn't survive a redeploy/restart on most hosts and isn't
  meant for production.
- `REDIS_URL` — optional everywhere, including production; caching and
  distributed rate limiting degrade to an in-memory fallback without it,
  scoped per-process rather than shared across instances.

**Migrations.** Run `npm run prisma:deploy` (`prisma migrate deploy`) as a
release step, before the new API version starts serving traffic — never
`prisma:migrate` (the interactive dev command) in CI/production. It applies
pending migrations only, no schema drift prompts, no dev-only reset options.

**Processes to run.**

| Process             | Command          | Notes                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                 | `npm start`      | Stateless — scale horizontally behind a load balancer                                                                                                                                                                                                                    |
| Notification worker | `npm run worker` | Separate long-running process; polls the `EmailNotification` outbox. Safe to run zero, one, or several — the claim step (`FOR UPDATE SKIP LOCKED`) makes concurrent workers safe, and running zero just means publish events queue in the outbox unsent until one exists |

**Health checks.** Point your orchestrator's liveness probe at
`GET /api/health/live` (process is up, no dependency checks — won't flap on a
transient DB blip) and any readiness/monitoring check at `GET /api/health`
(reports database and Redis status, `503` if the database is unreachable).

**Testing against a real deployment pipeline.** The integration suite runs
against whatever database `DATABASE_URL` points to and does not sandbox
itself — pointing it at a shared or production database would create and
delete real rows. For CI, provision a dedicated Neon branch (Neon's
branch-per-PR/branch-per-run feature is built for exactly this), migrate and
seed it, run `npm test` against that branch's connection string, then let the
branch be torn down. Never point `npm test` at a production `DATABASE_URL`.

**Logging.** Structured JSON via pino to stdout — ship it to whatever your
host aggregates (most PaaS providers and container platforms capture stdout
automatically; nothing in this app writes to a log file).
