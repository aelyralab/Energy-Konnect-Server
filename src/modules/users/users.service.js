import ApiError from "../../utils/ApiError.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import * as repo from "./users.repository.js";

export async function getProfile(userId) {
  const user = await repo.findById(userId);
  if (!user) throw ApiError.notFound("Account not found");
  return user;
}

export async function updateProfile(userId, { name, emailNotifications }) {
  const data = {};
  if (name !== undefined) data.name = name;
  if (emailNotifications !== undefined) data.emailNotifications = emailNotifications;
  return repo.update(userId, data);
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await repo.findById(userId);
  if (!user) throw ApiError.notFound("Account not found");

  const matches = await verifyPassword(currentPassword, user.passwordHash);
  if (!matches) {
    throw ApiError.badRequest("Current password is incorrect", { field: "currentPassword" });
  }

  const passwordHash = await hashPassword(newPassword);
  await repo.update(userId, { passwordHash });
  // The password just changed — every token issued under the old one should
  // stop working, including the session making this very request; the client
  // is expected to sign in again afterwards.
  await repo.revokeAllRefreshTokens(userId);
}

// --- Admin-only ----------------------------------------------------------
// This is the only way a user becomes PUBLISHER or ADMIN — registration
// always creates role=USER (IMPLEMENTATION_PLAN.md §0.2.1). Role/isActive
// changes take effect on the *next* request with no extra revocation step:
// auth.middleware.js's requireAuth re-reads the user row from the database
// on every request rather than trusting the access token's embedded role
// claim, specifically so a demotion or deactivation can't keep working under
// a still-valid 15-minute token.

export async function listForAdmin(query) {
  const { items, total } = await repo.findAllForAdmin(query);
  return { items, total, page: query.page, limit: query.limit };
}

export async function adminUpdate(actorId, targetId, { role, isActive }) {
  const target = await repo.findById(targetId);
  if (!target) throw ApiError.notFound("Account not found");

  // An admin locking themselves out (self-demote or self-deactivate) has no
  // recovery path short of direct database access — refuse it outright
  // rather than let it happen by accident.
  if (targetId === actorId) {
    if (role !== undefined && role !== "ADMIN") {
      throw ApiError.conflict(
        "You cannot change your own role away from ADMIN",
        "CANNOT_SELF_DEMOTE",
      );
    }
    if (isActive === false) {
      throw ApiError.conflict("You cannot deactivate your own account", "CANNOT_SELF_DEACTIVATE");
    }
  }

  const data = {};
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;

  const updated = await repo.update(targetId, data);
  if (isActive === false) {
    await repo.revokeAllRefreshTokens(targetId);
  }
  return updated;
}
