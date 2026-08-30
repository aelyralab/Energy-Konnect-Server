/**
 * Application logger (pino).
 *
 * Pretty-printed in all environments for readable logs. Silent under test
 * unless LOG_LEVEL says otherwise.
 */
import pino from "pino";
import env, { isTest } from "./env.js";

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.password",
  "*.passwordHash",
  "*.currentPassword",
  "*.newPassword",
  "*.otp",
  "*.otpHash",
  "*.refreshToken",
  "*.token",
];

const logger = pino({
  level: isTest ? (process.env.LOG_LEVEL ?? "silent") : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: "[redacted]" },
  base: undefined, // drop pid/hostname noise; the platform adds its own
  transport: isTest
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: false,
          translateTime: "HH:MM:ss",
          ignore: "req,res,responseTime",
          messageFormat: "{msg}",
        },
      },
});

export default logger;
