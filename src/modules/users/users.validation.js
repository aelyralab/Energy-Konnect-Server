import { z } from "zod";
import { paginationQuery } from "../../utils/pagination.js";

const password = z.string().min(8, "Password must be at least 8 characters").max(200);

export const updateMeSchema = {
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      emailNotifications: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: "No changes provided" }),
};

export const changePasswordSchema = {
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: password,
  }),
};

// --- Admin-only ------------------------------------------------------------

export const adminListQuerySchema = {
  query: paginationQuery.extend({
    role: z.enum(["USER", "PUBLISHER", "ADMIN"]).optional(),
    search: z.string().trim().min(1).max(200).optional(),
  }),
};

export const adminIdParamSchema = { params: z.object({ id: z.string().uuid() }) };

export const adminUpdateSchema = {
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      role: z.enum(["USER", "PUBLISHER", "ADMIN"]).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: "No changes provided" }),
};
