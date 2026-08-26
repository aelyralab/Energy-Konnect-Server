/**
 * The only place a User row is allowed to become JSON. `passwordHash` never
 * leaves this file's input side — every other module gets the row through
 * this function, never straight from Prisma (IMPLEMENTATION_PLAN.md §2:
 * "a leak then requires someone to add a field on purpose").
 */
export function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    emailNotifications: user.emailNotifications,
    createdAt: user.createdAt,
  };
}

export default serializeUser;
