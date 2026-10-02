// Routes for authentication, mounted at /auth in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/auth.ts";
import { requireAuth } from "@src/middleware/auth.ts";

const router = Router();

// Public: exchanges email + password for a JWT
router.post("/login", controller.login);
// Protected: requireAuth validates the Bearer token and loads the user before the controller runs
router.get("/me", requireAuth, controller.me);

export default router;
