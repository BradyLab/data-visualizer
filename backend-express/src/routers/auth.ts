// Routes for authentication, mounted at /auth in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/auth.ts";
import { requireAuth } from "@src/middleware/auth.ts";

const router = Router();

// Public: exchanges email + password for a JWT
router.post("/login", controller.login);
// Protected: requireAuth validates the Bearer token and loads the user before the controller runs
router.get("/me", requireAuth, controller.me);
// Protected: acknowledges the logout; the client is responsible for discarding the token
router.post("/logout", requireAuth, controller.logout);
// Protected: changes the logged-in user's password after checking the old one
router.post("/change-password", requireAuth, controller.changePassword);

export default router;
