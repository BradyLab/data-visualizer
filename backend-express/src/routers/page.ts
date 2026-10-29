// Routes for the editable pages, mounted at /pages in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/page.ts";
import { requireAuth, requireRole } from "@src/middleware/auth.ts";
import { UserRoles } from "@commons/user.ts";

// Express router for reading and editing page content
const router = Router();

// Anyone, logged in or not, may read a page
router.get("/:slug", controller.get);

// Only admins may change a page
router.put("/:slug", requireAuth, requireRole(UserRoles.ADMIN), controller.update);

export default router;
