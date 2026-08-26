/**
 * §45 rule 3: email verification is required. auth.service.js has been
 * exercised manually since Phase 3 but never had an automated regression
 * test — this closes that gap. Deliberately narrow: proving the
 * verification *gate* holds, not re-testing the OTP hashing/expiry
 * mechanics themselves, which aren't independently §45-numbered.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "../../src/config/db.js";
import { retireTestUsers } from "../helpers/users.js";
import * as authService from "../../src/modules/auth/auth.service.js";

const createdUserIds = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await retireTestUsers(createdUserIds);
  }
});

describe("auth — §45 rule 3: email verification is required", () => {
  it("a freshly registered account starts unverified", async () => {
    const email = `phase11-verify-${randomUUID().slice(0, 8)}@example.com`;
    const user = await authService.register({
      name: "Phase 11 Test",
      email,
      password: "Test-Password-123",
    });
    createdUserIds.push(user.id);
    expect(user.emailVerified).toBe(false);
  });

  it("login is refused for an unverified account, even with the correct password", async () => {
    const email = `phase11-verify-${randomUUID().slice(0, 8)}@example.com`;
    const user = await authService.register({
      name: "Phase 11 Test",
      email,
      password: "Test-Password-123",
    });
    createdUserIds.push(user.id);

    await expect(
      authService.login({ email, password: "Test-Password-123" }, {}),
    ).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("login succeeds once the account is verified", async () => {
    const email = `phase11-verify-${randomUUID().slice(0, 8)}@example.com`;
    const user = await authService.register({
      name: "Phase 11 Test",
      email,
      password: "Test-Password-123",
    });
    createdUserIds.push(user.id);

    // Bypasses the real OTP flow deliberately — this test is about the
    // verification *gate*, not the OTP mechanism (register() only emails
    // the code, by design, so nothing test-accessible can read the real
    // one without a production-only backdoor this codebase doesn't have).
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });

    const session = await authService.login({ email, password: "Test-Password-123" }, {});
    expect(session.user.emailVerified).toBe(true);
    expect(typeof session.accessToken).toBe("string");
  });
});
