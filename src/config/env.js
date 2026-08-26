/**
 * Environment configuration.
 *
 * Every variable the server reads is declared and validated here, once, at boot.
 * If something required is missing or malformed the process exits immediately
 * with a readable report — the alternative is a `undefined` secret silently
 * producing tokens nobody can verify three phases later.
 */
import "dotenv/config";
import { z } from "zod";

const bool = (defaultValue) =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),
  // The API's own externally-reachable origin — used to build absolute links
  // inside emails (e.g. the unsubscribe link), which have to work from
  // inside a mail client with no notion of "relative to this app".
  API_BASE_URL: z.string().default("http://localhost:4000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),

  // --- Redis --------------------------------------------------------------
  // Optional: the API degrades to no caching / in-memory rate limits without it.
  REDIS_URL: z.string().optional(),

  // --- Auth ---------------------------------------------------------------
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be at least 32 characters"),
  COOKIE_DOMAIN: z.string().optional(),

  // --- OTP / guest limit --------------------------------------------------
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  GUEST_ARTICLE_LIMIT: z.coerce.number().int().nonnegative().default(2),

  // --- Email --------------------------------------------------------------
  // console = log the message instead of sending (default, zero setup).
  // smtp    = Gmail SMTP via nodemailer — used in development.
  // resend  = Resend HTTP API — required in production.
  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("Energy Konnect <noreply@energykonnect.local>"),

  RESEND_API_KEY: z.string().optional(),

  // Gmail requires an App Password (Google Account → Security → 2-Step
  // Verification → App passwords), not the account's normal login password —
  // Google rejects SMTP auth with a regular password.
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: bool("true"), // true = implicit TLS (port 465); false = STARTTLS (port 587)
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // --- Storage ------------------------------------------------------------
  STORAGE_PROVIDER: z.enum(["local", "cloudinary"]).default("local"),
  LOCAL_UPLOAD_DIR: z.string().default(".uploads"),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // --- Notifications --------------------------------------------------------
  // How often the outbox worker (src/worker.js) polls for PENDING emails.
  // Not exponential backoff — the fixed interval between poll cycles *is*
  // the backoff between an email's retry attempts (§0.4: no BullMQ, this
  // system's email volume doesn't need a fancier scheduler).
  EMAIL_OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  EMAIL_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  EMAIL_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  // --- Behaviour flags ----------------------------------------------------
  TRUST_PROXY: bool("false"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  // Deliberately console, not the logger: the logger is configured from env.
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  console.error("Copy .env.example to .env and fill in the missing values.\n");
  process.exit(1);
}

const env = parsed.data;

// Cross-field rules that zod cannot express field-by-field.
const crossFieldErrors = [];

if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
  crossFieldErrors.push("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
}

if (env.EMAIL_PROVIDER === "smtp") {
  const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((key) => !env[key]);
  if (missing.length > 0) {
    crossFieldErrors.push(`EMAIL_PROVIDER=smtp requires ${missing.join(", ")}`);
  }
}

if (env.STORAGE_PROVIDER === "cloudinary") {
  const missing = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].filter(
    (key) => !env[key],
  );
  if (missing.length > 0) {
    crossFieldErrors.push(`STORAGE_PROVIDER=cloudinary requires ${missing.join(", ")}`);
  }
}

if (env.NODE_ENV === "production") {
  if (!["resend", "smtp"].includes(env.EMAIL_PROVIDER)) {
    // Only block unknown providers; both resend and smtp are valid in production.
    crossFieldErrors.push("EMAIL_PROVIDER must be 'resend' or 'smtp' in production");
  }
  if (env.STORAGE_PROVIDER === "local") {
    crossFieldErrors.push("STORAGE_PROVIDER=local is not allowed in production");
  }
}

if (crossFieldErrors.length > 0) {
  console.error(
    `\nInvalid environment configuration:\n${crossFieldErrors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  process.exit(1);
}

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const isDevelopment = env.NODE_ENV === "development";

export default env;
