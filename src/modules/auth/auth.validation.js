import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address");
const otp = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");
// Length only here — complexity theatre (must contain a symbol, etc.) rejects
// good passphrases and pushes users toward "Password1!" patterns. Argon2id
// makes brute force expensive regardless of character set.
const password = z.string().min(8, "Password must be at least 8 characters").max(200);

export const registerSchema = {
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(120),
    email,
    password,
  }),
};

export const verifyOtpSchema = {
  body: z.object({ email, otp }),
};

export const resendOtpSchema = {
  body: z.object({ email }),
};

export const loginSchema = {
  body: z.object({
    email,
    password: z.string().min(1, "Password is required"),
  }),
};
