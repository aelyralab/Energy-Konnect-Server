# Energy Konnect API Reference

Base URL: `{API_BASE_URL}/api` — e.g. `http://localhost:4000/api` in development.

## Conventions

**Auth header.** `Authorization: Bearer <accessToken>` on every protected route. Access
tokens are short-lived JWTs returned by register/verify-otp/login/refresh. A long-lived
refresh token lives in an `httpOnly`, signed cookie (`ek_refresh`, path `/api/auth`) — the
browser sends it automatically to `/api/auth/refresh` and `/api/auth/logout`; it is never
exposed to JavaScript or to any other route.

**Response envelope.** Every response is one of:

```jsonc
// success
{ "data": { /* ... */ }, "meta": { /* present on paginated lists */ } }

// error
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { /* optional */ } } }
```

Controllers never call `res.json` directly — this shape is enforced in one place
([respond.js](src/utils/respond.js)) so it can't drift endpoint by endpoint.

**Pagination.** Any list endpoint accepts `?page=1&limit=20` (`limit` max 100, both
optional). Paginated responses carry:

```jsonc
"meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
```

**Roles.** `USER`, `PUBLISHER`, `ADMIN` — that's the complete set; there is no separate
Guest role in the data model. An unauthenticated caller is simply a request with no
`Authorization` header. A user becomes a `PUBLISHER` only by an admin promoting them via
`PATCH /api/admin/users/:id`; there is no self-service upgrade path.

**Common error codes.**

| HTTP | code                                        | when                                                                       |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------- |
| 400  | `BAD_REQUEST`                               | malformed request the schema layer can't even parse                        |
| 401  | `UNAUTHORIZED`                              | missing/invalid/expired access token                                       |
| 401  | `EMAIL_NOT_VERIFIED`                        | login attempted before the account's email is verified                     |
| 401  | `GUEST_LIMIT_REACHED`                       | anonymous reader hit the free-article cap (see below)                      |
| 403  | `FORBIDDEN_ROLE`                            | authenticated, but caller's role isn't allowed on this route               |
| 403  | `FORBIDDEN`                                 | authenticated, allowed role, but not the resource's owner (comment delete) |
| 404  | `NOT_FOUND`                                 | resource doesn't exist, or (deliberately) exists but isn't yours           |
| 404  | `ROUTE_NOT_FOUND`                           | no route matches the method+path at all                                    |
| 409  | `CONFLICT`                                  | state conflict (e.g. acting on an article in the wrong status)             |
| 422  | `VALIDATION_ERROR` / `UNPROCESSABLE_ENTITY` | body/query/params failed zod validation                                    |
| 429  | `RATE_LIMITED`                              | auth endpoint rate limit tripped                                           |
| 500  | `INTERNAL_ERROR`                            | unhandled server error                                                     |

**Ownership vs. authorization.** Fetching another publisher's own draft returns `404`, not
`403` — the response never confirms the article exists at all. Deleting someone else's
comment returns `403` instead, since that comment's existence is already public via the
article's own comment list.

**Guest article limit.** Unauthenticated readers may open up to `GUEST_ARTICLE_LIMIT`
(env-configured) distinct published articles, tracked by a signed `ek_guest` cookie;
re-reading an already-opened article never counts again. Authenticated readers of any role
are exempt entirely. A fourth+ distinct article returns `401 GUEST_LIMIT_REACHED`.

---

## Auth — `/api/auth` (public)

### `POST /auth/register`

Rate-limited: 5/hour per IP+email.

```jsonc
// request
{ "name": "Asha Rao", "email": "asha@example.com", "password": "correct-horse-battery" }
// 201
{ "data": { "user": { "id": "...", "name": "Asha Rao", "email": "asha@example.com", "role": "USER", "emailVerified": false, "emailNotifications": true, "createdAt": "..." }, "message": "Account created. Check your email for a verification code." } }
```

### `POST /auth/verify-otp`

Rate-limited: 10/15min per email.

```jsonc
// request
{ "email": "asha@example.com", "otp": "482913" }
// 200 — sets ek_refresh cookie
{ "data": { "user": { "...": "...", "emailVerified": true }, "accessToken": "eyJ..." } }
```

### `POST /auth/resend-otp`

Rate-limited: 1/min and 5/hour per email. Response is deliberately identical whether or
not the email exists/is already verified, to avoid confirming account existence.

```jsonc
{ "email": "asha@example.com" }
// 200
{ "data": { "message": "If that email is registered and not yet verified, a new code has been sent." } }
```

### `POST /auth/login`

Rate-limited: 10/15min per email. Fails with `401 EMAIL_NOT_VERIFIED` if the account hasn't
completed OTP verification yet — password reset is out of scope for V1, so an unverified
account has no path forward except re-registering the OTP flow via resend.

```jsonc
{ "email": "asha@example.com", "password": "correct-horse-battery" }
// 200 — sets ek_refresh cookie
{ "data": { "user": { /* ... */ }, "accessToken": "eyJ..." } }
```

### `POST /auth/refresh`

No body — reads the `ek_refresh` cookie. Rotates the refresh token (old one is invalidated)
and returns a fresh access token + cookie.

### `POST /auth/logout`

No body. Invalidates and clears the `ek_refresh` cookie. `204 No Content`.

### `GET /auth/me` — auth required

Equivalent to `GET /api/me`; kept for symmetry with the rest of the auth flow.

---

## Current user — `/api/me` (auth required)

### `GET /me`

```jsonc
{
  "data": {
    "user": {
      "id": "...",
      "name": "...",
      "email": "...",
      "role": "PUBLISHER",
      "emailVerified": true,
      "emailNotifications": true,
      "createdAt": "...",
    },
  },
}
```

### `PATCH /me`

Any subset of the editable fields; at least one required.

```jsonc
{ "name": "Asha K. Rao", "emailNotifications": false }
```

### `PATCH /me/password`

```jsonc
{ "currentPassword": "correct-horse-battery", "newPassword": "another-good-passphrase" }
```

---

## Notifications

### `GET /me/notifications` — auth required

Paginated. Every in-app notification for the caller, newest first.

```jsonc
{
  "data": [
    {
      "id": "...",
      "type": "ARTICLE_PUBLISHED",
      "articleId": "...",
      "title": "Your article was published",
      "message": "...",
      "isRead": false,
      "createdAt": "...",
    },
  ],
  "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 },
}
```

### `PATCH /me/notifications/:id/read` — auth required

Marks one notification read. No body.

### `GET /notifications/unsubscribe` — public

The one-click unsubscribe link in outbound emails; authenticated by its own signed
`?token=` query param, not a session — there's no browser session available from an email
client. Flips the target user's `emailNotifications` off.

---

## Public content

### Articles — `/api/articles`

#### `GET /articles`

Paginated list of published articles. Query: `page`, `limit`, `category`, `topic`, `tag`,
`issue` (all slugs), `featured` (`true`/`false`), `sort` (`latest` default | `oldest`).
Each item is an article **summary** (no block content).

#### `GET /articles/:slug`

Full article detail including ordered content blocks. Subject to the guest-read limit for
anonymous callers (see Conventions). 404 if the slug doesn't resolve to a `PUBLISHED`
article.

```jsonc
{
  "data": {
    "id": "...",
    "slug": "grid-scale-storage-2026",
    "title": "...",
    "subtitle": "...",
    "summary": "...",
    "author": { "name": "...", "bio": "..." },
    "category": { "id": "...", "name": "Renewables", "slug": "renewables" },
    "topics": [{ "id": "...", "name": "Storage", "slug": "storage" }],
    "tags": [{ "id": "...", "name": "Batteries", "slug": "batteries" }],
    "issue": {
      "id": "...",
      "slug": "vol-3-issue-1",
      "volume": 3,
      "issue": 1,
      "period": "Q1 2026",
      "section": "Features",
    },
    "coverImage": "https://.../cover.jpg",
    "featured": false,
    "readingTime": "6 min read",
    "publishedAt": "...",
    "content": [{ "id": "...", "type": "paragraph", "order": 0, "data": { "text": "..." } }],
  },
}
```

#### `GET /articles/:slug/comments`

Paginated top-level comments for the article (public — no auth required to read).

### Categories — `GET /api/categories`

All active categories, unpaginated. `[{ "id", "name", "slug" }]`

### Topics — `GET /api/topics`

Same shape as categories.

### Tags — `GET /api/tags`

Same shape as categories.

### Publications (issues) — `/api/publications`

#### `GET /publications`

Paginated list of published issues (summary shape — no article contents).

#### `GET /publications/:slug`

Full issue detail with its published articles grouped by section, in display order.

```jsonc
{
  "data": {
    "id": "...",
    "slug": "vol-3-issue-1",
    "title": "Volume 3, Issue 1",
    "volume": 3,
    "issue": 1,
    "period": "Q1 2026",
    "theme": "...",
    "description": "...",
    "coverImage": "...",
    "publishedAt": "...",
    "pdfUrl": "https://.../issue.pdf",
    "contents": [{ "section": "Features", "displayOrder": 0, "article": {/* article summary */} }],
  },
}
```

### Search — `GET /api/search`

Full-text search over published articles. Query: `q` (required), `page`, `limit`,
`category`, `topic`, `tag` (slugs). Ranked by weighted `tsvector`: title (A) > subtitle +
summary (B) > category/topic/tag names (C) > author name (D). Results are article
summaries.

### Comments — `/api/comments` (auth required)

Single-level only — there is no reply/parent concept; any `parentCommentId` in the request
body is silently ignored.

#### `POST /comments`

```jsonc
{ "articleId": "...", "content": "Great overview of the storage economics." }
// 201
{ "data": { "id": "...", "articleId": "...", "content": "...", "author": { "id": "...", "name": "Asha Rao" }, "createdAt": "...", "updatedAt": "..." } }
```

#### `DELETE /comments/:id`

Author or an ADMIN only — `403 FORBIDDEN` otherwise. `204 No Content`.

---

## Media

### `POST /api/media` — PUBLISHER or ADMIN

`multipart/form-data`, field name `file`. Images: 10 MB cap, dimensions probed from the
uploaded bytes. PDFs: larger cap for issue PDFs. Files are stored outside PostgreSQL (local
disk in dev, S3/Cloudinary-compatible in production) under a randomly generated storage
key — never the caller-supplied filename — only a URL + metadata row is persisted.

```jsonc
// 201
{
  "data": {
    "id": "...",
    "fileName": "cover.jpg",
    "url": "https://.../abc123.jpg",
    "mimeType": "image/jpeg",
    "fileSize": 482113,
    "width": 1600,
    "height": 900,
    "createdAt": "...",
  },
}
```

Errors: `422 UNSUPPORTED_FILE_TYPE`, `413`/`422 FILE_TOO_LARGE`.

### `GET /api/admin/media` — ADMIN

Paginated list of every uploaded asset, each with its uploader.

---

## Publisher workflow — `/api/publisher` (role `PUBLISHER`)

A publisher only ever sees and acts on their own articles — any `:id` belonging to another
publisher returns `404`, not `403`. Creating, editing, and revising all go through the
version-pointer mechanism: editing a live article writes to a new _pending_ version, never
touching the version the public currently sees, until an admin approves it.

### `GET /articles`

Paginated list of the caller's own articles (any status), owner-facing shape:

```jsonc
{
  "data": [
    {
      "id": "...",
      "slug": null,
      "title": "...",
      "status": "DRAFT",
      "category": {/* ... */},
      "coverImage": null,
      "isPublished": false,
      "hasPendingRevision": false,
      "createdAt": "...",
      "updatedAt": "...",
    },
  ],
  "meta": {/* ... */},
}
```

### `POST /articles`

Create a new draft (status `DRAFT`). Body: title, authorName, categoryId required;
subtitle/summary/authorBio/coverMediaId optional; `blocks` (see Content blocks below,
may be empty for a draft); optional `topicIds`/`tagIds` arrays.

### `GET /articles/:id`

Owner detail: both `pendingVersion` (open for editing, if any) and `publishedVersion` (the
live public content, if any) — an article can have either, both, or briefly just the
former.

### `PUT /articles/:id`

Replace the pending version's full content (same body shape as create). Works on a
`DRAFT`, and — via `revise` below — on a live article too.

### `POST /articles/:id/submit`

Moves a `DRAFT` to `PENDING_REVIEW`, entering the admin review queue. Requires at least one
meaningful content block and all the mandatory metadata fields — a stricter gate than the
lenient in-progress-draft save.

### `POST /articles/:id/withdraw`

Pulls a `PENDING_REVIEW` submission back to `DRAFT` before an admin has acted on it.

### `POST /articles/:id/revise`

Opens a new pending version on an already-`PUBLISHED` article, so it can be edited without
touching what readers currently see. The resulting pending version follows the same
submit/approve path as a fresh draft.

### `DELETE /articles/:id`

Deletes a `DRAFT` that was never submitted. `204 No Content`.

### `GET /articles/:id/history`

The article's full audit trail of review actions (submit/approve/reject/etc.), each with
its actor and timestamp.

---

## Admin

Everything under `/api/admin/*` requires role `ADMIN`.

### Review queue — `GET /api/admin/reviews`

Paginated list of every article currently `PENDING_REVIEW`, across all publishers.

### Articles — `/api/admin/articles`

Superset of the publisher workflow: admins can create and directly publish an article with
no review step (context doc §30), edit already-_published_ content in place, and act on
any publisher's submission.

#### `GET /articles` · `GET /articles/:id`

Same shapes as the publisher endpoints, but unscoped — any article, any publisher.

#### `POST /articles?publish=true|false`

Create an article as admin. With `publish=true`, the article is published immediately
(no `PENDING_REVIEW` step); default is `false` (creates a `DRAFT`, same as a publisher
would).

#### `PUT /articles/:id`

Edit the article's pending/draft version (same as the publisher's own `PUT`).

#### `PUT /articles/:id/published-content`

Edit the _live_ published version's content directly, in place — no new version, no
review cycle. Reserved for admin corrections to content that's already public.

#### `POST /articles/:id/approve`

Approves a `PENDING_REVIEW` submission: promotes its pending version to
`currentPublishedVersion`, publishes the article. `200`, returns the updated article with
`status: "PUBLISHED"`.

#### `POST /articles/:id/reject`

```jsonc
{ "reason": "Needs a stronger data source for the emissions figures." }
```

Returns the article to `DRAFT` (or, for a revision, discards the pending version and
leaves the previously-published version untouched) and records the reason on the audit
trail.

#### `POST /articles/:id/publish` / `POST /articles/:id/unpublish` / `POST /articles/:id/archive`

Direct lifecycle transitions, no body. `unpublish` takes a live article off the public
site without deleting it (it can be republished later); `archive` is the terminal state.

#### `GET /articles/:id/versions` · `GET /articles/:id/versions/:versionId`

Every version an article has ever had, and one version's full content by id — the complete
edit history, not just the current pending/published pair.

#### `GET /articles/:id/history`

Same audit-trail shape as the publisher endpoint, unscoped.

#### `DELETE /articles/:id`

Hard delete, any status — unlike the publisher's `DELETE`, which only ever touches a
never-published draft. Cascades to every version, comment, review-action audit row, issue
placement, notification and guest-read record for the article. `204 No Content`.

### Issues — `/api/admin/issues`

Publication issues have a lifecycle fully independent of the articles inside them — an
issue can be `PUBLISHED` while one of its articles is `UNPUBLISHED`; the public
`/api/publications/:slug` response filters those out rather than trusting the join.

#### `GET /issues` · `GET /issues/:id`

Paginated list / single issue, admin shape (all statuses, unfiltered contents).

#### `POST /issues`

```jsonc
{
  "volumeNumber": 3,
  "issueNumber": 1,
  "title": "Volume 3, Issue 1",
  "period": "Q1 2026",
  "theme": "Grid Storage",
  "description": "...",
  "coverMediaId": "...",
  "pdfMediaId": "...",
}
```

#### `PUT /issues/:id`

Partial update — any subset of the create fields; nullable fields accept `null` to clear.

#### `DELETE /issues/:id`

`204 No Content`.

#### `POST /issues/:id/articles`

Attach an article to the issue.

```jsonc
{ "articleId": "...", "sectionLabel": "Features", "displayOrder": 0 }
```

#### `PATCH /issues/:id/articles/reorder`

Bulk-set display order/section for the issue's articles in one call.

```jsonc
{
  "articles": [
    { "articleId": "...", "displayOrder": 0, "sectionLabel": "Features" },
    { "articleId": "...", "displayOrder": 1 },
  ],
}
```

#### `DELETE /issues/:id/articles/:articleId`

Detach one article from the issue. `204 No Content`.

#### `POST /issues/:id/publish` / `POST /issues/:id/archive`

No body.

### Users — `/api/admin/users`

#### `GET /users`

Paginated. Query: `role` (`USER`|`PUBLISHER`|`ADMIN`), `search` (name/email substring).

#### `PATCH /users/:id`

The only way a `USER` becomes a `PUBLISHER` (or is demoted/promoted otherwise) — there is
no self-service role change. Also the deactivation switch (`isActive: false`); deactivated
users are never hard-deleted (their comments must survive them), just locked out.

```jsonc
{ "role": "PUBLISHER" }
```

A stale JWT reflects the change immediately — `requireAuth` re-reads the user's role from
the database on every request rather than trusting the token's embedded claim.

### Categories / Topics / Tags admin — `/api/admin/categories`, `/api/admin/topics`, `/api/admin/tags`

Identical shape across all three taxonomy types.

#### `GET /` — paginated, `?search=`

#### `POST /`

```jsonc
{ "name": "Renewables", "description": "...", "isActive": true }
```

#### `PATCH /:id` — partial; at least one field. Accepts an explicit `slug` override.

#### `DELETE /:id` — `204 No Content`.

### Media admin — see [Media](#media) above (`GET /api/admin/media`).

---

## Health — `/api/health` (public)

### `GET /health`

Dependency check (DB, Redis if configured). `200` if healthy, `503` if not.

```jsonc
{ "data": { "status": "ok", "checks": { "database": "ok", "redis": "ok" } } }
```

### `GET /health/live`

Liveness only — process is up, no dependency checks. Always `200` unless the process is
down. Use this for a load balancer/orchestrator health probe.

---

## Content blocks

An article version's `blocks` array is `[{ "blockType": "...", "content": { /* type-specific */ } }]`.
Ten types, validated by a zod discriminated union
([blockSchemas.js](src/utils/blockSchemas.js)) — an unrecognized `blockType`, or a `table`
block whose row lengths don't match its column count, is rejected before it ever reaches
Postgres:

| blockType   | content shape                                                                     |
| ----------- | --------------------------------------------------------------------------------- |
| `heading`   | `{ level: 1-6, text }`                                                            |
| `paragraph` | `{ text }`                                                                        |
| `image`     | `{ mediaId, caption?, altText? }`                                                 |
| `quote`     | `{ text, attribution? }`                                                          |
| `callout`   | `{ title?, text }`                                                                |
| `table`     | `{ columns: string[], rows: string[][] }` — every row must match `columns.length` |
| `figure`    | `{ mediaId, caption?, source? }`                                                  |
| `list`      | `{ style: "ordered" \| "unordered", items: string[] }`                            |
| `formula`   | `{ formula, caption? }`                                                           |
| `reference` | `{ title, url, description? }`                                                    |

A draft may legitimately have zero blocks — the "at least one meaningful block" rule is
enforced only at submit-for-review time, not on every save.
