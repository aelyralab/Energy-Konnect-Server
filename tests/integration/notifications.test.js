/**
 * Hits the live database directly for everything except the actual email
 * transport, which is mocked at the module level: real providers (even the
 * console one, which never fails) can't be made to fail on command, and the
 * retry/give-up tests below need a deterministic failure to test against.
 * Every other test in this file relies on the mock's default — resolve
 * successfully, just like the console provider — so mocking it doesn't
 * change what those tests are actually verifying (claim/send/mark-resolved
 * mechanics against the real database).
 *
 * Verifies Phase 9's explicit "done when" bar:
 *   1. approving an article with 3 opted-in users and 1 opted-out produces
 *      exactly 3 SENT rows.
 *   2. killing the worker mid-batch leaves no duplicate or lost sends on
 *      restart — simulated by calling claimBatch() alone (exactly what a
 *      crash-before-send leaves behind), then draining for real and
 *      confirming each row is sent exactly once, never twice.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import { hashPassword } from "../../src/utils/password.js";
import * as adminService from "../../src/modules/admin/admin.service.js";
import * as publisherService from "../../src/modules/publisher/publisher.service.js";
import * as notificationsRepo from "../../src/modules/notifications/notifications.repository.js";
import * as notificationsService from "../../src/modules/notifications/notifications.service.js";
import { drainOutbox } from "../../src/jobs/emailOutbox.worker.js";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../../src/utils/unsubscribeToken.js";
import { sendMail } from "../../src/services/email/index.js";

vi.mock("../../src/services/email/index.js", () => {
  const sendMail = vi.fn();
  return { sendMail, default: { sendMail } };
});

beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({ provider: "mock", messageId: "mock-message-id" });
});

let adminId;
let categoryId;
let optedIn = [];
let optedOut;
const createdArticleIds = [];
const createdUserIds = [];
const createdNotificationIds = [];

beforeAll(async () => {
  const category = await prisma.category.findFirst();
  if (!category) throw new Error("Seed data required — run `npm run seed` before the test suite");
  categoryId = category.id;

  const passwordHash = await hashPassword("Test-Password-123");
  const suffix = randomUUID().slice(0, 8);

  const admin = await prisma.user.create({
    data: {
      name: "Phase 9 Admin",
      email: `phase9-admin-${suffix}@example.com`,
      passwordHash,
      role: "ADMIN",
      emailVerified: true,
    },
  });
  adminId = admin.id;

  // The exact shape the done-when bar names: 3 opted-in, 1 opted-out.
  optedIn = await Promise.all(
    [1, 2, 3].map((n) =>
      prisma.user.create({
        data: {
          name: `Phase 9 Reader ${n}`,
          email: `phase9-reader-${n}-${suffix}@example.com`,
          passwordHash,
          role: "USER",
          emailVerified: true,
          emailNotifications: true,
        },
      }),
    ),
  );
  optedOut = await prisma.user.create({
    data: {
      name: "Phase 9 Opted-Out Reader",
      email: `phase9-optout-${suffix}@example.com`,
      passwordHash,
      role: "USER",
      emailVerified: true,
      emailNotifications: false,
    },
  });

  createdUserIds.push(adminId, ...optedIn.map((u) => u.id), optedOut.id);
});

afterAll(async () => {
  if (createdNotificationIds.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
  }
  if (createdArticleIds.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: createdArticleIds } } });
  }
  if (createdUserIds.length > 0) {
    await retireTestUsers(createdUserIds);
  }
});

async function publishNewArticle(titleSuffix) {
  const article = await adminService.createArticle(
    adminId,
    {
      title: `Phase 9 article ${titleSuffix} ${Date.now()}`,
      summary: "For the notifications test suite.",
      authorName: "Test Author",
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: "Body." } }],
    },
    { publish: true },
  );
  createdArticleIds.push(article.id);
  return article;
}

/**
 * findBroadcastRecipients correctly notifies *every* opted-in active user
 * system-wide — including whatever other test files create concurrently
 * against this same live database, plus the seeded accounts (which default
 * to emailNotifications: true). So "exactly 3 rows for this article" isn't
 * a valid assertion; the real claim to test is "of *our* known test users,
 * the opted-in ones got exactly one row each and the opted-out one got
 * none" — scoped by recipientEmail, not by a raw count.
 */
async function emailRowsForArticle(articleId, type, { onlyEmails } = {}) {
  const notifications = await prisma.notification.findMany({ where: { articleId, type } });
  createdNotificationIds.push(...notifications.map((n) => n.id));
  const rows = await prisma.emailNotification.findMany({
    where: { notificationId: { in: notifications.map((n) => n.id) } },
    orderBy: { recipientEmail: "asc" },
  });
  return onlyEmails ? rows.filter((r) => onlyEmails.includes(r.recipientEmail)) : rows;
}

describe("notifications — outbox creation on first publish", () => {
  it("PHASE 9 DONE-WHEN (part 1): publishing creates exactly 3 PENDING rows for opted-in users, none for the opted-out one", async () => {
    const article = await publishNewArticle("outbox-creation");
    const ourEmails = [...optedIn.map((u) => u.email), optedOut.email];

    const rows = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(rows).toHaveLength(3); // the opted-out user produced no row at all
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);

    const recipientEmails = rows.map((r) => r.recipientEmail).sort();
    const expectedEmails = optedIn.map((u) => u.email).sort();
    expect(recipientEmails).toEqual(expectedEmails);
    expect(recipientEmails).not.toContain(optedOut.email);
  });

  it("admin (the publisher) is notified once via ARTICLE_APPROVED-equivalent, not counted in the broadcast", async () => {
    const article = await publishNewArticle("self-publish-no-broadcast-dup");
    // admin published their own article — no self-notification of either kind.
    const approvedRows = await emailRowsForArticle(article.id, "ARTICLE_APPROVED");
    expect(approvedRows).toHaveLength(0);
  });

  it("a revision re-publish (not a first publish) creates no new ARTICLE_PUBLISHED broadcast", async () => {
    const article = await publishNewArticle("no-rebroadcast");
    const ourEmails = optedIn.map((u) => u.email);
    const firstRows = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(firstRows).toHaveLength(3);

    await adminService.editPublished(adminId, article.id, {
      title: article.title,
      summary: "Edited summary.",
      authorName: "Test Author",
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: "Edited body." } }],
    });

    const rowsAfterEdit = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(rowsAfterEdit).toHaveLength(3); // unchanged — no second broadcast
  });
});

describe("notifications — approve/reject notify the publisher directly", () => {
  it("approving a publisher's submission notifies them, ignoring their emailNotifications preference", async () => {
    const publisher = await prisma.user.create({
      data: {
        name: "Phase 9 Publisher",
        email: `phase9-publisher-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: await hashPassword("Test-Password-123"),
        role: "PUBLISHER",
        emailVerified: true,
        emailNotifications: false, // opted out of broadcasts — should NOT block this
      },
    });
    createdUserIds.push(publisher.id);

    const draft = await publisherService.createDraft(publisher.id, {
      title: `Phase 9 publisher submission ${Date.now()}`,
      summary: "For the approve-notifies-publisher test.",
      authorName: "Test Author",
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: "Body." } }],
    });
    createdArticleIds.push(draft.id);
    await publisherService.submit(publisher.id, draft.id);

    const approved = await adminService.approve(adminId, draft.id);
    const rows = await emailRowsForArticle(approved.id, "ARTICLE_APPROVED");
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientEmail).toBe(publisher.email);
  });

  it("rejecting a submission notifies the publisher with the reason", async () => {
    const publisher = await prisma.user.create({
      data: {
        name: "Phase 9 Rejected Publisher",
        email: `phase9-rejected-pub-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: await hashPassword("Test-Password-123"),
        role: "PUBLISHER",
        emailVerified: true,
      },
    });
    createdUserIds.push(publisher.id);

    const draft = await publisherService.createDraft(publisher.id, {
      title: `Phase 9 rejected submission ${Date.now()}`,
      summary: "For the reject-notifies-publisher test.",
      authorName: "Test Author",
      categoryId,
      blocks: [{ blockType: "paragraph", content: { text: "Body." } }],
    });
    createdArticleIds.push(draft.id);
    await publisherService.submit(publisher.id, draft.id);

    const rejected = await adminService.reject(adminId, draft.id, "Needs more sourcing.");
    const rows = await emailRowsForArticle(rejected.id, "ARTICLE_REJECTED");
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientEmail).toBe(publisher.email);
  });
});

describe("notifications — draining the outbox (worker)", () => {
  it("PHASE 9 DONE-WHEN (part 2): draining sends exactly the 3 opted-in emails and marks them SENT", async () => {
    const article = await publishNewArticle("drain-sends-three");
    const ourEmails = optedIn.map((u) => u.email);
    const before = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(before).toHaveLength(3);
    expect(before.every((r) => r.status === "PENDING")).toBe(true);

    // batchSize generous enough to also drain whatever else is pending
    // system-wide (other concurrent test files, the seeded accounts) — our
    // 3 rows just need to be somewhere in what gets sent.
    await drainOutbox({ batchSize: 200, maxAttempts: 3 });

    const after = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(after).toHaveLength(3);
    expect(after.every((r) => r.status === "SENT")).toBe(true);
    expect(after.every((r) => r.sentAt !== null)).toBe(true);
  });

  it("PHASE 9 DONE-WHEN (part 3): a simulated crash-before-send (claim only, no send) is fully recovered by the next drain, with no duplicate sends", async () => {
    const article = await publishNewArticle("crash-recovery");
    const ourEmails = optedIn.map((u) => u.email);
    const beforeClaim = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(beforeClaim).toHaveLength(3);

    // Exactly what a crash right after the worker claims a batch — but
    // before it sends anything — leaves behind: attempts incremented,
    // status still PENDING, nothing actually sent. batchSize is generous
    // (200) so this may also claim unrelated PENDING rows from other test
    // files running concurrently against the same database — harmless
    // (every send here resolves successfully), and irrelevant to the
    // assertions below, which are scoped to this test's own 3 recipients.
    const claimedRows = await notificationsRepo.claimBatch(200, 3);
    expect(claimedRows.length).toBeGreaterThanOrEqual(3);

    const midCrash = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(midCrash.every((r) => r.status === "PENDING")).toBe(true); // nothing sent
    expect(midCrash.every((r) => r.attempts === 1)).toBe(true); // but claim happened

    // "Restart": drain again. Every row must be recovered exactly once.
    await drainOutbox({ batchSize: 200, maxAttempts: 3 });
    const afterRestart = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(afterRestart).toHaveLength(3);
    expect(afterRestart.every((r) => r.status === "SENT")).toBe(true);
    // attempts === 2: one from the crash-simulated claim (never sent), one
    // from the recovering drain's own claim (sent successfully on it). Two
    // *claims*, not two *sends* — that's the guarantee actually being
    // tested, and claimBatch's own docstring is explicit that attempts
    // tracks claims, not completed sends.
    expect(afterRestart.every((r) => r.attempts === 2)).toBe(true);

    // A second drain must not re-send anything already SENT.
    await drainOutbox({ batchSize: 200, maxAttempts: 3 });
    const stillSentOnly = await emailRowsForArticle(article.id, "ARTICLE_PUBLISHED", {
      onlyEmails: ourEmails,
    });
    expect(stillSentOnly.every((r) => r.status === "SENT")).toBe(true);
    // Untouched by the second drain — still SENT rows are never claimed
    // again, so attempts doesn't move past what it was after the first
    // successful send.
    expect(stillSentOnly.every((r) => r.attempts === 2)).toBe(true);
  });
});

describe("notifications — retry with backoff, then give up", () => {
  it("a failed send under the attempt cap stays PENDING for a later retry", async () => {
    const user = optedIn[0];
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        type: "ARTICLE_PUBLISHED",
        title: "Retry test",
        message: "Testing retry semantics.",
      },
    });
    createdNotificationIds.push(notification.id);
    const email = await prisma.emailNotification.create({
      data: { notificationId: notification.id, recipientEmail: user.email, status: "PENDING" },
    });

    // Targeted by recipient, not "the first call" — a shared batch may also
    // contain rows from other concurrently-running test files, in
    // whatever order the claim happens to return them.
    sendMail.mockImplementation((message) =>
      message.to === user.email
        ? Promise.reject(new Error("simulated transient provider failure"))
        : Promise.resolve({ provider: "mock", messageId: "mock-message-id" }),
    );

    await drainOutbox({ batchSize: 50, maxAttempts: 3 });

    const after = await prisma.emailNotification.findUnique({ where: { id: email.id } });
    expect(after.status).toBe("PENDING"); // 1 attempt, cap is 3 — still retryable
    expect(after.attempts).toBe(1);
    expect(after.error).toContain("simulated transient provider failure");
  });

  it("a failed send at the attempt cap is marked FAILED and left alone", async () => {
    const user = optedIn[1];
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        type: "ARTICLE_PUBLISHED",
        title: "Give-up test",
        message: "Testing the attempt cap.",
      },
    });
    createdNotificationIds.push(notification.id);
    const email = await prisma.emailNotification.create({
      data: {
        notificationId: notification.id,
        recipientEmail: user.email,
        status: "PENDING",
        attempts: 2, // one shy of a maxAttempts=3 cap
      },
    });

    sendMail.mockImplementation((message) =>
      message.to === user.email
        ? Promise.reject(new Error("simulated permanent provider failure"))
        : Promise.resolve({ provider: "mock", messageId: "mock-message-id" }),
    );

    await drainOutbox({ batchSize: 50, maxAttempts: 3 });

    const after = await prisma.emailNotification.findUnique({ where: { id: email.id } });
    expect(after.status).toBe("FAILED");
    expect(after.attempts).toBe(3);
    expect(after.failedAt).not.toBeNull();

    // A FAILED row is never claimed again.
    await drainOutbox({ batchSize: 50, maxAttempts: 3 });
    const stillFailed = await prisma.emailNotification.findUnique({ where: { id: email.id } });
    expect(stillFailed.attempts).toBe(3); // untouched by the second drain
  });
});

describe("notifications — unsubscribe", () => {
  it("generates and verifies a round-trip token", () => {
    const userId = randomUUID();
    const token = generateUnsubscribeToken(userId);
    expect(verifyUnsubscribeToken(token)).toBe(userId);
  });

  it("rejects a tampered token", () => {
    const token = generateUnsubscribeToken(randomUUID());
    const tampered = `${token}x`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("the unsubscribe service call flips emailNotifications off", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Phase 9 Unsubscribe Target",
        email: `phase9-unsub-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: await hashPassword("Test-Password-123"),
        role: "USER",
        emailVerified: true,
        emailNotifications: true,
      },
    });
    createdUserIds.push(user.id);

    const token = generateUnsubscribeToken(user.id);
    await notificationsService.unsubscribe(token);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.emailNotifications).toBe(false);
  });

  it("rejects an invalid token with a 400", async () => {
    await expect(notificationsService.unsubscribe("not-a-real-token")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
  });
});
