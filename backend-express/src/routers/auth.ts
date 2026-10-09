// Routes for authentication, mounted at /auth in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/auth.ts";
import { requireAuth, requireAuthAllowInvited } from "@src/middleware/auth.ts";
import { changePasswordLimiter, loginAccountLimiter, loginIpLimiter } from "@src/middleware/rateLimit.ts";

const router = Router();

// Public: exchanges email + password for a JWT; failed attempts are rate limited per IP and per account (429)
router.post("/login", loginIpLimiter, loginAccountLimiter, controller.login);

// Protected: requireAuthAllowInvited validates the Bearer token and loads the user before the controller runs (INVITED users allowed)
router.get("/me", requireAuthAllowInvited, controller.me);

// Protected: acknowledges the logout; the client is responsible for discarding the token
router.post("/logout", requireAuthAllowInvited, controller.logout);

// Protected: changes the logged-in user's password after checking the old one; failed attempts are rate limited per user (429)
router.post("/change-password", requireAuthAllowInvited, changePasswordLimiter, controller.changePassword);

export default router;
