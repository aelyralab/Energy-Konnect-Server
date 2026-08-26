import { Router } from "express";
import requireAuth from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as usersController from "./users.controller.js";
import { updateMeSchema, changePasswordSchema } from "./users.validation.js";

const router = Router();

// Every route here requires a signed-in user — role doesn't matter, USER,
// PUBLISHER and ADMIN all have a profile.
router.use(requireAuth);

router.get("/", usersController.getMe);
router.patch("/", validate(updateMeSchema), usersController.updateMe);
router.patch("/password", validate(changePasswordSchema), usersController.changePassword);

export default router;
