import prisma from "../../src/config/db.js";

/**
 * Test-file cleanup for fixture users.
 *
 * Deliberately *not* a delete. Test files run in parallel against one shared
 * database, and `findBroadcastRecipients` is a global query — it selects every
 * active, opted-in user, including the fixtures another file created seconds
 * ago. `notifyIssuePublished` reads that list and then inserts one notification
 * row per recipient, inside the publishing transaction.
 *
 * A `user.deleteMany` in one file's afterAll lands in the gap between that read
 * and that insert, and because `Notification.user` cascades the delete succeeds
 * — so the *other* file's transaction is the one that dies, on
 * `notifications_user_id_fkey`. That is the flake: not deterministic, not the
 * fault of the test that fails, and invisible when the file runs alone.
 *
 * Deactivating closes it. The row stays, so no in-flight foreign key can break;
 * `isActive: false` and `emailNotifications: false` both drop the user out of
 * every broadcast query immediately, so retired fixtures stop reaching later
 * publishes. It also mirrors what production actually does — there is no
 * hard-delete path for a user anywhere in src/, only deactivation (see the
 * `onDelete: Restrict` note on Article.publisher in schema.prisma).
 *
 * The rows are removed for real in tests/globalSetup.js's teardown, which runs
 * after every file has finished and therefore races nothing.
 */
export async function retireTestUsers(userIds) {
  if (userIds.length === 0) return;
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { isActive: false, emailNotifications: false },
  });
}

export default retireTestUsers;
