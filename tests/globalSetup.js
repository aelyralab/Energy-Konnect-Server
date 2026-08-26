import { PrismaClient } from "@prisma/client";

/**
 * Runs once per `vitest run`, in its own process, either side of the whole
 * suite. Its job is the cleanup that cannot safely happen while test files are
 * still running: hard-deleting the fixture users that each file retired in its
 * afterAll (see tests/helpers/users.js).
 *
 * By the time `teardown` runs, no transaction is in flight anywhere, so
 * deleting a user cannot pull the row out from under another file's
 * notification fan-out.
 *
 * Fixture accounts are identified by their email domain. Every integration test
 * creates users at `@example.com`; the seeded accounts use `@energykonnect.dev`
 * and are never touched here.
 */
const TEST_EMAIL_DOMAIN = "@example.com";

export function setup() {
  // Nothing to prepare — the suite expects an already-seeded database
  // (`npm run seed`), which each file asserts on for itself.
}

export async function teardown() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
      select: { id: true },
    });
    if (users.length === 0) return;
    const ids = users.map((user) => user.id);

    // Order matters: Comment.userId, Article.publisherId and
    // ArticleVersion.createdBy are all `onDelete: Restrict`, so anything still
    // pointing at these accounts has to go first. Deleting the article cascades
    // its versions and blocks, which is what clears the version FK.
    await prisma.comment.deleteMany({ where: { userId: { in: ids } } });
    await prisma.article.deleteMany({
      where: {
        OR: [{ publisherId: { in: ids } }, { versions: { some: { createdBy: { in: ids } } } }],
      },
    });
    const { count } = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    if (count > 0) console.log(`\n[globalTeardown] removed ${count} test accounts`);
  } catch (error) {
    // Teardown failing must never be mistaken for a test failing. Say so and
    // move on — leftovers are inert (deactivated, opted out of broadcasts) and
    // the next run sweeps them up.
    console.warn(`\n[globalTeardown] cleanup skipped: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}
