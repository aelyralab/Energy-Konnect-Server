import { Router } from "express";
import validate from "../../middleware/validate.middleware.js";
import requireAuth from "../../middleware/auth.middleware.js";
import rateLimit, { emailKey } from "../../middleware/rateLimit.middleware.js";
import * as authController from "./auth.controller.js";
import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
} from "./auth.validation.js";

const router = Router();

// Limits are deliberately narrow (IMPLEMENTATION_PLAN.md §0.2.4): registration
// and resend both send mail, so both are throttled per-email as well as
// per-IP to stop one caller from mail-bombing an arbitrary inbox.
const registerLimiter = rateLimit({ name: "register", windowSeconds: 3600, max: 5 });
const loginLimiter = rateLimit({
  name: "login",
  windowSeconds: 15 * 60,
  max: 10,
  keyFn: emailKey,
});
const verifyOtpLimiter = rateLimit({
  name: "verify-otp",
  windowSeconds: 15 * 60,
  max: 10,
  keyFn: emailKey,
});
const resendOtpBurstLimiter = rateLimit({
  name: "resend-otp-burst",
  windowSeconds: 60,
  max: 1,
  keyFn: emailKey,
});
const resendOtpHourlyLimiter = rateLimit({
  name: "resend-otp-hourly",
  windowSeconds: 3600,
  max: 5,
  keyFn: emailKey,
});

router.post("/register", registerLimiter, validate(registerSchema), authController.register);
router.post("/verify-otp", verifyOtpLimiter, validate(verifyOtpSchema), authController.verifyOtp);
router.post(
  "/resend-otp",
  resendOtpBurstLimiter,
  resendOtpHourlyLimiter,
  validate(resendOtpSchema),
  authController.resendOtp,
);
router.post("/login", loginLimiter, validate(loginSchema), authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.get("/me", requireAuth, authController.me);

export default router;
