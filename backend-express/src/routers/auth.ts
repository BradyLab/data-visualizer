// Routes for authentication, mounted at /auth in index.ts
import { Router } from "express";
import * as controller from "../controllers/auth.ts";
import { requireAuth } from "../middleware/auth.ts";

const router = Router();

router.post("/login", controller.login);
router.get("/me", requireAuth, controller.me);

export default router;
