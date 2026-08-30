# Energy Konnect Backend — Implementation Plan

**Stack (confirmed):** Node.js + Express (JavaScript, ESM) · Prisma · PostgreSQL (Neon) · Redis (Upstash) · Cloudinary · Resend · PostgreSQL FTS · REST

**Repo layout:** `client/` (TanStack Start, TypeScript — already scaffolded) · `server/` (this plan — empty today)

---

## 0. Decisions taken before coding

These are calls made from the context document plus what the existing client actually expects. Each is reversible, but they need to be settled now because they shape the schema.

### 0.1 Confirmed choices

| Area             | Choice                                                                | Reason                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language         | JavaScript, ESM (`"type": "module"`)                                  | Your call. Files match the context doc listing (`auth.controller.js`, …).                                                                                                                                          |
| Postgres         | Neon                                                                  | Serverless, branchable — a throwaway branch per test run is nearly free.                                                                                                                                           |
| Redis            | Upstash (`rediss://`)                                                 | No local install. See §0.4 for the quota constraint it creates.                                                                                                                                                    |
| Password hashing | `@node-rs/argon2`                                                     | Argon2id as the doc recommends. Prebuilt binaries — no node-gyp / VS Build Tools on Windows, unlike `argon2` or `bcrypt`.                                                                                          |
| Validation       | `zod`                                                                 | Client already runs zod v3; request and response shapes can stay in step.                                                                                                                                          |
| Tokens           | JWT access (15 min) + opaque refresh (30 d, hashed at rest, rotating) | Doc asks for access + refresh. Opaque refresh tokens are revocable; JWT refresh tokens are not.                                                                                                                    |
| Tests            | Vitest + Supertest                                                    | Fast, ESM-native, no Babel.                                                                                                                                                                                        |
| Email            | console (default) → Gmail SMTP (dev) → Resend (production)            | Team preference set during Phase 3: real inbox delivery via Gmail while developing, Resend only in production (SMTP send caps aren't meant for production traffic). Falls back to console-logging with zero setup. |
| Media storage    | Behind an adapter interface with a local-disk dev fallback            | Writes to `server/.uploads/` until Cloudinary keys land, so Phases 2–8 are never blocked on credentials.                                                                                                           |

### 0.2 Gaps in the context document — resolutions

The doc is thorough but has seven points it does not decide. These are my resolutions; flag any you disagree with before Phase 1.

1. **How does a user become a PUBLISHER?** Nothing in the doc covers it. Registration always creates `role = USER`. Only an ADMIN can promote via `PATCH /api/admin/users/:id`. The first ADMIN comes from a seed script.
2. **Are topics/tags versioned?** The doc versions `category_id` (§12) but puts topics/tags on the _article_ (§17, §18) — inconsistent. Resolution: topics and tags stay article-level and are edited directly; only `category_id` is versioned, as written. Consequence: a publisher retagging a published article changes it live without review. Acceptable for V1 given tags are non-editorial; if you want them under review, we add `version_topics` / `version_tags` and the cost is one extra copy step in the revision service.
3. **Does the slug change when the title changes?** No. The slug is generated once from the first title and frozen after first publish — published URLs must not rot. Admin can override it explicitly. No redirect table in V1.
4. **OTP resend / rate limits.** Not mentioned but mandatory. OTP is 6 digits, 10-minute expiry, max 5 verify attempts, resend throttled to 1/60 s and 5/hour per email. Login throttled to 10/15 min per IP+email.
5. **Change password while logged in.** V1 excludes password _reset_ (no email link flow). An authenticated `PATCH /api/me/password` requiring the current password is a different thing and is cheap — I have included it. Say so if you want it out.
6. **Guest 2-article limit, server side.** §5 says the backend "may additionally enforce" it. I am enforcing it: a signed `ek_guest` cookie holds a random id, and `guest_reads(guest_id, article_id)` is unique. The 3rd distinct article returns `401 GUEST_LIMIT_REACHED`. It is defeatable by clearing cookies — that is true of every soft paywall, and it is still a real boundary rather than a frontend suggestion.
7. **Deleting articles.** A publisher can hard-delete only their own `DRAFT` that has never been published — everything else goes `UNPUBLISHED → ARCHIVED`, per §32. An admin can hard-delete any article at any status; the cascade takes its versions, comments, review-action audit trail, issue placements, notifications and guest-read records with it (see schema.prisma relations), and the deletion itself is recorded to the application log rather than as a review action, since the audit row would just cascade away with the article it describes.

### 0.3 What the existing client expects that the schema doesn't cover

`client/src/data/articles.js` is the mock the frontend renders today. It carries fields the doc's `articles` table (§11) omits. I am adding them rather than making the client drop features it already has:

| Client field                              | Backend addition                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `coverImage`                              | `articles.cover_media_id → media_assets`                                                                                                |
| `readingTime` ("11 min read")             | `article_versions.reading_minutes`, computed from block word count on save                                                              |
| `featured`                                | `articles.is_featured`                                                                                                                  |
| `section` ("Tutorial", "Cover Story")     | Already exists as `issue_articles.section_label` (§20); the API surfaces it on the article payload when the article belongs to a magazine |
| `topics: [names]` + `topicSlugs: [slugs]` | Both derived from the `article_topics` join; API returns `[{id, name, slug}]` and the client maps                                       |

**One conflict needs a frontend change.** The mock stores blocks flat — `{type:"heading", level:2, text:"…"}` — while §35 of the doc specifies `{id, type, order, data:{level, text}}`. I am building the documented shape (it is the correct one: block identity and ordering are relational, payload is JSONB). The client's `ArticleContentRenderer` will need a small adjustment to read `block.data.*`. Two other mismatches to fold in at the same time: the mock's list block uses `ordered: true|false` where the doc uses `style: "ordered"|"unordered"`, and the mock's image block uses `src` where the doc uses `media_id`. I will follow the doc and note the exact client diff when we reach Phase 5.

### 0.4 Constraint worth knowing now: Upstash free tier

Upstash bills per command. A BullMQ worker polls, so an idle queue still burns commands continuously, and fanning out one email job per subscriber multiplies it. Design accordingly:

- **Redis holds one job per publication event**, not one per recipient.
- **The recipient fan-out lives in Postgres.** Approving an article writes `notifications` rows plus `email_notifications` rows at `PENDING` inside the same transaction — a transactional outbox. The worker claims a batch with `FOR UPDATE SKIP LOCKED`, sends, and marks `SENT` / `FAILED`.
- Result: email delivery is crash-safe and idempotent, and Redis usage stays flat regardless of subscriber count. Redis is then really only doing caching and rate-limit counters.

If Upstash quota still bites in Phase 9, the same outbox runs on a plain `setInterval` poller with Redis removed entirely — no code changes outside the queue adapter.

---

## 1. Database schema

Sixteen models. Beyond the doc's §43 list I add `refresh_tokens` (needed for revocable sessions) and `guest_reads` (needed for §5 server-side enforcement).

### Enums

```
Role                USER | PUBLISHER | ADMIN
ArticleStatus       DRAFT | PENDING_REVIEW | PUBLISHED | REJECTED | UNPUBLISHED | ARCHIVED
VersionStatus       DRAFT | PENDING_REVIEW | PUBLISHED | REJECTED | SUPERSEDED
MagazineStatus      DRAFT | PUBLISHED | ARCHIVED
BlockType           heading | paragraph | image | quote | callout | table | figure | list | formula | reference
ReviewAction        SUBMITTED | APPROVED | REJECTED | WITHDRAWN | PUBLISHED_DIRECT | UNPUBLISHED | ARCHIVED
NotificationType    ARTICLE_PUBLISHED | ARTICLE_APPROVED | ARTICLE_REJECTED | ISSUE_PUBLISHED
EmailStatus         PENDING | SENT | FAILED
OtpPurpose          EMAIL_VERIFICATION
```

`VersionStatus.SUPERSEDED` is not in the doc; without it there is no way to tell version 1 (retired) from version 2 (live) once both have been `PUBLISHED`.

### Models

```
users                     id, name, email(unique, citext), password_hash, role, email_verified,
                          is_active, email_notifications, created_at, updated_at
user_email_verifications  id, user_id, otp_hash, purpose, expires_at, consumed_at, attempts, created_at
refresh_tokens            id, user_id, token_hash(unique), expires_at, revoked_at, replaced_by_id,
                          user_agent, ip, created_at

articles                  id, slug(unique), title, subtitle, summary, author_name, author_bio,
                          category_id, publisher_id, cover_media_id, status, is_featured,
                          current_published_version_id, pending_version_id,
                          search_text, search_vector(tsvector, generated), published_at,
                          created_at, updated_at
article_versions          id, article_id, version_number, created_by, status, title, subtitle,
                          summary, author_name, author_bio, category_id, cover_media_id,
                          reading_minutes, created_at, submitted_at, approved_at, rejected_at
                          @@unique([article_id, version_number])
article_content_blocks    id, article_version_id, block_order, block_type, content(Json),
                          created_at, updated_at
                          @@unique([article_version_id, block_order])

categories                id, name, slug(unique), description, is_active, created_at, updated_at
topics                    id, name, slug(unique), description, is_active, created_at, updated_at
tags                      id, name, slug(unique), created_at
article_topics            article_id, topic_id  @@id([article_id, topic_id])
article_tags              article_id, tag_id    @@id([article_id, tag_id])

magazines                 id, slug(unique), volume_number, issue_number, title, period, theme,
                          description, cover_media_id, pdf_media_id, status, published_at,
                          created_at, updated_at
                          @@unique([volume_number, issue_number])
magazine_articles         magazine_id, article_id, display_order, section_label
                          @@id([magazine_id, article_id])

comments                  id, article_id, user_id(onDelete: Restrict), content, is_deleted,
                          created_at, updated_at
media_assets              id, file_name, storage_key, url, mime_type, file_size, width, height,
                          uploaded_by, created_at
article_review_actions    id, article_id, article_version_id, actor_id, action, reason, created_at
notifications             id, user_id, type, article_id, title, message, is_read, created_at
email_notifications       id, notification_id, recipient_email, status, provider_message_id,
                          attempts, sent_at, failed_at, error
guest_reads               id, guest_id, article_id, created_at  @@unique([guest_id, article_id])
```

### Points that matter

- **`articles.current_published_version_id` / `pending_version_id`** are the whole §29 mechanism. Both are nullable FKs to `article_versions`, and `article_versions.article_id` points back — a cycle Prisma handles with named relations. The public reader resolves content strictly through `current_published_version_id`; nothing else is ever served publicly.
- **Comments use `onDelete: Restrict`** on `user_id`. Rule 23 says comments must survive user deletion — `Restrict` makes a cascading delete _impossible at the database level_, not merely discouraged. Deactivation sets `users.is_active = false`; the comment API returns `author: null` and the client renders "Deleted User".
- **Full-text search.** Prisma cannot express `tsvector`, so `search_vector` is added in a hand-written migration as `GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED` with a GIN index. `search_text` is a plain column the article service rebuilds on every save from title + subtitle + summary + author name + category + topic names + tag names — exactly the §42 field list. Queries run through `$queryRaw` with `websearch_to_tsquery` and `ts_rank`.
- **Indexes:** `articles(status, published_at DESC)` for the public feed, `articles(category_id)`, `articles(publisher_id, status)` for the publisher dashboard, `comments(article_id, created_at)`, `magazine_articles(magazine_id, display_order)`, `email_notifications(status, created_at)` for the outbox claim.
- **`citext`** for `users.email` so `Nilanjan@…` and `nilanjan@…` are one account.

---

## 2. Project structure

```
server/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.js                     # admin user, categories, topics, tags, 2 issues, sample articles
├── src/
│   ├── server.js                   # http listen, graceful shutdown
│   ├── app.js                      # express app (importable by tests without listening)
│   ├── worker.js                   # separate process: notification/email worker
│   ├── config/
│   │   ├── env.js                  # zod-validated process.env — fails fast at boot
│   │   ├── db.js  redis.js  cloudinary.js  logger.js
│   ├── middleware/
│   │   ├── auth.middleware.js      # requireAuth / optionalAuth
│   │   ├── role.middleware.js      # requireRole(...roles)
│   │   ├── validate.middleware.js  # zod on body/query/params
│   │   ├── guestLimit.middleware.js
│   │   ├── rateLimit.middleware.js # Redis-backed
│   │   ├── upload.middleware.js    # multer memory storage
│   │   ├── notFound.middleware.js
│   │   └── error.middleware.js     # single place that converts errors to HTTP
│   ├── modules/                    # each: *.routes / *.controller / *.service / *.repository / *.validation
│   │   ├── auth/ users/ articles/ articleVersions/ contentBlocks/
│   │   ├── categories/ topics/ tags/ magazines/ archive/ comments/
│   │   ├── media/ reviews/ notifications/ search/
│   │   ├── publisher/              # publisher-scoped routes over the article services
│   │   └── admin/                  # admin-scoped routes over the article services
│   ├── jobs/
│   │   ├── queue.js  publicationEmail.job.js  emailOutbox.worker.js
│   ├── services/                   # cross-cutting providers behind interfaces
│   │   ├── email/  (resend.provider.js, console.provider.js, templates/)
│   │   └── storage/ (cloudinary.provider.js, local.provider.js)
│   ├── utils/
│   │   ├── jwt.js password.js otp.js slug.js pagination.js
│   │   ├── ApiError.js asyncHandler.js readingTime.js blockSchemas.js
│   │   └── serializers/            # single source of truth for API response shapes
│   └── routes/index.js             # mounts /api/*
├── tests/
│   ├── setup.js  helpers/  integration/  unit/
├── .env  .env.example  package.json  README.md  API.md
```

Two rules enforced throughout, per §37 and §49: controllers never touch Prisma, and services never touch `req` / `res`.

**Serializers are not optional.** Rule 30 says public endpoints must never expose unpublished content. The reliable way to guarantee that is to never hand a raw Prisma object to `res.json()` — every response passes through an explicit serializer that names its fields. A leak then requires someone to add a field on purpose.

---

## 3. API surface

### Public — no auth

```
GET    /api/health
GET    /api/articles                  ?page&limit&category&topic&tag&issue&featured&sort
GET    /api/articles/:slug            guest-limited; PUBLISHED only
GET    /api/articles/:slug/comments   ?page&limit
GET    /api/categories                GET /api/topics                GET /api/tags
GET    /api/magazines                 GET /api/magazines/:slug
GET    /api/search                    ?q&page&limit&category&topic&tag
```

### Auth

```
POST   /api/auth/register             { name, email, password }
POST   /api/auth/verify-otp           { email, otp }
POST   /api/auth/resend-otp           { email }
POST   /api/auth/login                { email, password }
POST   /api/auth/refresh              refresh cookie → new access + rotated refresh
POST   /api/auth/logout               revokes the refresh token
GET    /api/auth/me
```

### Account — any authenticated role

```
GET    /api/me
PATCH  /api/me                        { name?, emailNotifications? }
PATCH  /api/me/password               { currentPassword, newPassword }
GET    /api/me/notifications          PATCH /api/me/notifications/:id/read
POST   /api/comments                  { articleId, content }
DELETE /api/comments/:id              own comment, or any if ADMIN
```

### Publisher — `role = PUBLISHER`, ownership checked on every route

```
GET    /api/publisher/articles        ?status
POST   /api/publisher/articles        creates article + version 1 (DRAFT)
GET    /api/publisher/articles/:id    full editable payload incl. blocks
PUT    /api/publisher/articles/:id    metadata + blocks of the editable version
POST   /api/publisher/articles/:id/submit
POST   /api/publisher/articles/:id/withdraw
POST   /api/publisher/articles/:id/revise      published → new pending version (§29)
DELETE /api/publisher/articles/:id    DRAFT, never-published only
GET    /api/publisher/articles/:id/history
POST   /api/publisher/media
```

### Admin — `role = ADMIN`

```
GET    /api/admin/reviews                       the PENDING_REVIEW queue
GET    /api/admin/articles                      ?status&publisher&q
POST   /api/admin/articles                      ?publish=true → straight to PUBLISHED (§30)
GET    /api/admin/articles/:id                  PUT /api/admin/articles/:id
POST   /api/admin/articles/:id/publish
POST   /api/admin/articles/:id/approve          { }
POST   /api/admin/articles/:id/reject           { reason }
POST   /api/admin/articles/:id/unpublish        POST /api/admin/articles/:id/archive
GET    /api/admin/articles/:id/versions         GET .../versions/:versionId
GET    /api/admin/articles/:id/history
CRUD   /api/admin/categories  /api/admin/topics  /api/admin/tags
CRUD   /api/admin/magazines
POST   /api/admin/magazines/:id/articles        { articleId, sectionLabel, displayOrder }
PATCH  /api/admin/magazines/:id/articles/reorder DELETE /api/admin/magazines/:id/articles/:articleId
POST   /api/admin/magazines/:id/publish         POST /api/admin/magazines/:id/archive
GET    /api/admin/users                         PATCH /api/admin/users/:id  { role?, isActive? }
DELETE /api/admin/comments/:id
GET    /api/admin/media                         POST /api/admin/media
```

### Response envelope

```jsonc
// success
{ "data": { }, "meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 } }
// error
{ "error": { "code": "GUEST_LIMIT_REACHED", "message": "…", "details": [ ] } }
```

Machine-readable `code` matters: the client needs to distinguish "register to keep reading" from a generic 401 without string-matching a message.

---

## 4. Phased build

Each phase ends in something runnable and verified. Nothing is "done" on the strength of the code compiling.

### Phase 1 — Foundation

Scaffold `server/`, dependencies, ESLint/Prettier matching the client's config. `config/env.js` validates every environment variable with zod and exits at boot if one is missing. Express app with `helmet`, CORS pinned to the client origin with credentials, `cookie-parser`, JSON body limits, `pino` request logging with a request id. `ApiError` + `asyncHandler` + the error middleware that maps `ApiError`, `ZodError` and `PrismaClientKnownRequestError` (P2002 → 409, P2025 → 404) onto the envelope. Connect Prisma to Neon, run an empty migration, confirm `GET /api/health` reports database and Redis reachability.

**Done when:** `npm run dev` boots and `/api/health` returns `{ db: "ok", redis: "ok" }`.

### Phase 2 — Schema + seed

Full `schema.prisma`, initial migration, hand-written migration for `citext` and the `search_vector` generated column and GIN index. `seed.js` creates the first admin, a publisher, a reader, the six categories and eight topics from §8, a tag set, both issues from `client/src/data/magazines.js`, and 3–4 articles ported from `client/src/data/articles.js` as real block rows.

**Done when:** `npx prisma migrate dev` and `npm run seed` run clean on a fresh Neon branch, and Prisma Studio shows the seeded article resolving through `current_published_version_id` to ordered blocks.

_The seed pays for itself immediately — every later phase gets realistic data to test against, and the client can point at a live API in Phase 4._

### Phase 3 — Auth

Argon2id hashing. Register → create user (`USER`, `email_verified: false`) → 6-digit OTP, hashed, 10-minute expiry → email. Verify, resend (throttled), login (blocked while unverified or deactivated), refresh with rotation and reuse detection (a replayed token revokes the whole family), logout. `requireAuth` / `optionalAuth` / `requireRole`. Redis-backed rate limits on register, login, verify and resend. `/api/me` read/update/password.

**Done when:** integration tests cover the full lifecycle — register → verify → login → refresh → rotated-token replay is rejected → logout — and unverified login is refused.

### Phase 4 — Taxonomy + public read endpoints

Categories, topics, tags: public list endpoints plus admin CRUD with slug generation and collision handling. Public article list with filtering and pagination (`PUBLISHED` only, enforced in the repository so no caller can forget). Public single article by slug resolving current version + ordered blocks + topics + tags + magazine context, in the §35 shape. Guest limit middleware and `guest_reads`. Redis caching on the taxonomy lists.

**Done when:** the client can drop `src/data/*.js` and render the homepage and an article from the API; requesting a third distinct article as a guest returns `GUEST_LIMIT_REACHED`; a `DRAFT` slug returns 404, not 403 (a 403 confirms the article exists).

### Phase 5 — Article core + blocks + media

Article / version / block services. `blockSchemas.js` holds a discriminated zod union over all ten §14 block types — an unknown `block_type`, or a `table` block whose rows do not match its column count, is rejected at the boundary. Block writes are diffed and replaced inside a transaction so `block_order` never has gaps or duplicates. Slug generation with a uniqueness suffix. Reading time from word count. Media upload through the storage adapter (Cloudinary in production, local disk in dev), MIME and size validation, dimensions probed for images.

**Done when:** unit tests pin every block type's schema including the rejection cases, and a version's blocks round-trip through save → fetch with order intact.

### Phase 6 — Publisher workflow

Create draft, update, submit with the §26 validation gate (title, summary, author name, category, and at least one non-empty block), withdraw, view rejection reason, resubmit. `revise` deep-copies the published version into version N+1 with all its blocks and sets `pending_version_id` while `current_published_version_id` stays untouched. Ownership is checked in the service on every mutation — never in the route, never on the frontend.

**Done when:** a test proves that while a revision is pending, the public endpoint still serves version 1 in full; and that publisher B gets 404 on publisher A's article at every one of these endpoints.

### Phase 7 — Admin workflow

Review queue. Approve: one transaction — article `PUBLISHED`, `current_published_version_id` = pending, previous version `SUPERSEDED`, `pending_version_id` = null, version `PUBLISHED`, versioned metadata copied onto the article row, `search_text` rebuilt, `APPROVED` review action, notification event queued. Reject with a required reason, both article and version to `REJECTED`, audit row written. Direct publish. Admin edit of a published article, which creates a new version and publishes it in one step rather than overwriting (§31). Unpublish, archive. Magazine management with article attach / reorder / section labels. User administration.

**Done when:** approve/reject are covered including the transaction rollback path, and a test asserts that publishing a magazine leaves its `DRAFT` and `PENDING_REVIEW` articles invisible to the public (§21, rule 18).

### Phase 8 — Comments

Create (requires a verified account and a `PUBLISHED` article), list with pagination, author delete, admin delete. Soft delete via `is_deleted`. Deactivated authors serialize as `author: null`.

**Done when:** a test deactivates a user and confirms their comments still return, with the author field nulled.

### Phase 9 — Notifications

Publication event → `notifications` + `PENDING` `email_notifications` rows written transactionally with the approval. BullMQ holds one job per event. Worker claims batches with `FOR UPDATE SKIP LOCKED`, sends through the email adapter, records provider message ids, retries failures with backoff, gives up after 3 attempts to `FAILED`. `users.email_notifications` is respected for publication mail; OTP mail ignores it (§41). Resend wired in with an unsubscribe link.

**Done when:** approving an article with 3 opted-in users and 1 opted-out produces exactly 3 `SENT` rows, and killing the worker mid-batch leaves no duplicate or lost sends on restart.

### Phase 10 — Search

`websearch_to_tsquery` with `ts_rank` ordering, `ts_headline` snippets, filters and pagination composed into the same query. Weighting: title `A`, subtitle/summary `B`, taxonomy `C`, author `D`.

Built out slightly differently than "`search_text` maintenance on every write path" originally implied: title/subtitle/summary/authorName are already real `Article` columns kept current by every existing write path, so `search_vector`'s generated-column expression reads them directly (see the `20260822140000_search_vector_weighting` migration) — no separate copy needed. `search_text` narrows to just the taxonomy component (category name + topic names + tag names), the one piece that genuinely lives in joined tables a generated column can't reach; `articles.service.js#refreshSearchText` is the only thing that still needs calling on a write path, and only where category or topic/tag associations can change.

**Done when:** searching "rooftop solar gujarat" against the seeded corpus returns the expected article first.

### Phase 11 — Hardening + tests + docs

Fill the §46 Phase 11 checklist — all eight named business rules get an explicit test. Full-suite pass against a dedicated Neon test branch, truncated between tests. `API.md` with every endpoint and example payloads. `README.md` with setup, migration and deployment notes. Production Dockerfile if you want containerized deployment.

**Done when:** the whole suite is green and every one of the thirty rules in §45 maps to at least one passing test.

**Status: done.** 11 test files, 135 tests, all green (`npx vitest run`). Four files were added this phase — `authorization.test.js` (HTTP/middleware-layer, via supertest against the exported `app.js`), `authFlow.test.js`, `media.test.js`, `businessRules.test.js` — specifically to close gaps left by Phases 1–10, whose tests call service functions directly and never exercised `requireAuth`/`requireRole`/zod `validate` as real middleware. `API.md` and this coverage table are the other two deliverables; a production Dockerfile was judged unnecessary for this deployment target and skipped.

### §45 rule → test coverage

| #   | Rule                                                                | Covered by                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Guest is not an application role                                    | [`businessRules.test.js`](tests/integration/businessRules.test.js) §45 rules 1,2; [`authorization.test.js`](tests/integration/authorization.test.js) §45 rules 1,2                                                           |
| 2   | Only USER/PUBLISHER/ADMIN are roles                                 | same as #1                                                                                                                                                                                                                   |
| 3   | Email verification is required                                      | [`authFlow.test.js`](tests/integration/authFlow.test.js)                                                                                                                                                                     |
| 4   | Password reset is not part of V1                                    | `businessRules.test.js` §45 rule 4                                                                                                                                                                                           |
| 5   | Author is plain article metadata                                    | `businessRules.test.js` §45 rule 5                                                                                                                                                                                           |
| 6   | Category is primary classification                                  | `businessRules.test.js` §45 rule 6                                                                                                                                                                                           |
| 7   | Topic is secondary thematic classification                          | `businessRules.test.js` §45 rules 7,8                                                                                                                                                                                        |
| 8   | Tag is flexible/granular                                            | same as #7                                                                                                                                                                                                                   |
| 9   | Article content uses structured blocks from V1                      | [`blockSchemas.test.js`](tests/unit/blockSchemas.test.js) (all 10 types + rejection cases); [`articleCore.test.js`](tests/integration/articleCore.test.js) "createArticle — article + version 1 + blocks as one transaction" |
| 10  | Publisher cannot directly publish new articles                      | `authorization.test.js` §45 rule 10 / checklist #1                                                                                                                                                                           |
| 11  | Admin can publish directly                                          | `authorization.test.js` §45 rule 11; [`adminWorkflow.test.js`](tests/integration/adminWorkflow.test.js) "direct publish and edit-published (§30, §31)"                                                                       |
| 12  | Publisher can edit their own published article                      | [`publisherWorkflow.test.js`](tests/integration/publisherWorkflow.test.js) "revise (§29) and the public-serving guarantee"                                                                                                   |
| 13  | Publisher's published-article edits require review                  | `publisherWorkflow.test.js` "revise" → `adminWorkflow.test.js` "approving a revision SUPERSEDES the previous published version" (the revise→approve round trip)                                                              |
| 14  | Existing published version stays public while a revision is pending | `publisherWorkflow.test.js` "the public-serving guarantee"                                                                                                                                                                   |
| 15  | Admin can directly edit published articles                          | `adminWorkflow.test.js` "editPublished creates a new version and publishes it immediately"                                                                                                                                   |
| 16  | Admin approval makes the pending version public                     | `adminWorkflow.test.js` "approve — promotes a submitted version to PUBLISHED: pointers, status, snapshot, audit row"                                                                                                         |
| 17  | Magazine has its own lifecycle                                       | `adminWorkflow.test.js` "admin workflow — magazines"                                                                                                                                                                            |
| 18  | Magazine status does not automatically publish child articles       | `adminWorkflow.test.js` "PHASE 7 DONE-WHEN: publishing a magazine leaves DRAFT/PENDING_REVIEW articles invisible to the public"                                                                                                |
| 19  | Article status controls public article visibility                   | `adminWorkflow.test.js` "unpublish/archive (§32) ... hides the article from the public endpoint"                                                                                                                             |
| 20  | Comments are single-level                                           | `businessRules.test.js` §45 rule 20                                                                                                                                                                                          |
| 21  | Comment reporting/flagging is not in V1                             | `businessRules.test.js` §45 rule 21                                                                                                                                                                                          |
| 22  | Admin can delete any comment                                        | [`comments.test.js`](tests/integration/comments.test.js) "delete"; `authorization.test.js` §45 rule 22 (over real HTTP, non-owner 403 vs admin 204)                                                                          |
| 23  | Comments survive user deletion/deactivation                         | `comments.test.js` "deactivated-author handling"; `businessRules.test.js` §45 rule 23 (DB-level FK proof deletion is impossible at all)                                                                                      |
| 24  | New publication triggers email notifications for opted-in users     | [`notifications.test.js`](tests/integration/notifications.test.js) "outbox creation on first publish"                                                                                                                        |
| 25  | Images/PDFs are stored outside PostgreSQL                           | [`media.test.js`](tests/integration/media.test.js) §45 rules 25/26                                                                                                                                                           |
| 26  | PostgreSQL stores media metadata/references                         | same as #25                                                                                                                                                                                                                  |
| 27  | Published article versions are not destructively overwritten        | `adminWorkflow.test.js` "approving a revision SUPERSEDES the previous published version rather than deleting it"                                                                                                             |
| 28  | Backend authorization does not rely on frontend role checks         | `authorization.test.js` (entire file — real HTTP through `requireAuth`/`requireRole`, not service calls)                                                                                                                     |
| 29  | Publisher ownership must be checked server-side                     | `publisherWorkflow.test.js` "ownership (§45 rule 29)"; `authorization.test.js` §45 rule 29 (same check, over real HTTP)                                                                                                      |
| 30  | Public endpoints must never expose unpublished content              | `adminWorkflow.test.js` (unpublish/archive hide from `/api/articles`); [`search.test.js`](tests/integration/search.test.js) "respects publication status"                                                                    |

### §46 Phase 11 checklist → test coverage

| Checklist item                                      | Covered by                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Publisher cannot publish directly                   | `authorization.test.js` §45 rule 10 / checklist #1                                                              |
| Publisher cannot modify another Publisher's article | `publisherWorkflow.test.js` "ownership"; `authorization.test.js` §45 rule 29                                    |
| Published revision stays private until approval     | `publisherWorkflow.test.js` "the public-serving guarantee"                                                      |
| Admin can direct publish                            | `adminWorkflow.test.js` "direct publish and edit-published"                                                     |
| Magazine status does not override article status     | `adminWorkflow.test.js` "PHASE 7 DONE-WHEN: publishing a magazine leaves DRAFT/PENDING_REVIEW articles invisible" |
| Rejected articles can be resubmitted                | `adminWorkflow.test.js` "a rejected article can be resubmitted and later approved"                              |
| Comments survive user deactivation                  | `comments.test.js` "deactivated-author handling"; `businessRules.test.js` §45 rule 23                           |
| Unpublished articles are not accessible publicly    | `adminWorkflow.test.js` unpublish/archive; `search.test.js` "respects publication status"                       |

---

## 5. Environment variables

```
NODE_ENV=development
PORT=4000
CLIENT_ORIGIN=http://localhost:3000

DATABASE_URL=postgresql://…@…neon.tech/energy_konnect?sslmode=require
DIRECT_URL=postgresql://…                # unpooled, for prisma migrate
REDIS_URL=rediss://default:…@….upstash.io:6379

JWT_ACCESS_SECRET=            JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30     COOKIE_SECRET=

OTP_TTL_MINUTES=10            OTP_MAX_ATTEMPTS=5
GUEST_ARTICLE_LIMIT=2

EMAIL_PROVIDER=console        # console | resend
RESEND_API_KEY=               EMAIL_FROM="Energy Konnect <noreply@…>"

STORAGE_PROVIDER=local        # local | cloudinary
CLOUDINARY_CLOUD_NAME=  CLOUDINARY_API_KEY=  CLOUDINARY_API_SECRET=
```

Neon needs both a pooled `DATABASE_URL` for the app and an unpooled `DIRECT_URL` for migrations — Prisma migrations fail against a PgBouncer connection.

---

## 6. Risks

| Risk                                          | Handling                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version-pointer bugs leak unpublished content | Every publish/approve path is one transaction; public reads go through a repository that hard-codes the `PUBLISHED` filter; serializers name their fields explicitly. |
| Neon cold starts on the free tier             | Prisma connection pool with a retry on first query; health check keeps it warm in dev.                                                                                |
| Upstash command quota                         | Postgres outbox instead of per-recipient Redis jobs (§0.4); Redis is removable behind the queue adapter.                                                              |
| `tsvector` outside Prisma's model             | Isolated in one hand-written migration plus `$queryRaw` in the search repository; nothing else in the codebase knows about it.                                        |
| Client/server block-shape mismatch            | Resolved deliberately in §0.3; the exact client diff lands with Phase 5.                                                                                              |
| Circular FK between articles and versions     | Named Prisma relations, both sides nullable, created in the documented order inside the transaction.                                                                  |

---

## 7. Sequencing

Phases 1 and 2 unblock everything and should land together. Phase 3 is independent of 4–7. Phase 4 is the one that lets the client stop using mock data, so it is worth reaching early. Phases 5, 6 and 7 are a single continuous piece of work — the workflow is not testable until all three exist. Phases 8, 9 and 10 are independent of each other and can land in any order.

Suggested order: **1+2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 9 → 11.** Search before notifications, because search is self-contained while notifications need the email provider decided.
