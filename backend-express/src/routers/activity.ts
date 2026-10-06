// Routes for Activities, mounted at /activities in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/activity.ts";
import { requireAuth, requireRole, requireSelfOrAdmin } from "@src/middleware/auth.ts";
import { UserRoles } from "@commons/user.ts";

// Express router for the activity read endpoints
const router = Router();

// Request flow: router (who is calling) -> controller (HTTP in/out) -> service (database)
// Activity logs hold user ids and event payloads, so every route needs a login and only admins see everything

// Admin only: lists every activity, optionally filtered
router.get("/", requireAuth, requireRole(UserRoles.ADMIN), controller.list);
// A user may read their own activity
router.get("/byUser/:userId", requireAuth, requireSelfOrAdmin("userId"), controller.listByUser);
// Admin only: a single activity can belong to any user
router.get("/:id",requireAuth, requireRole(UserRoles.ADMIN), controller.get);

export default router;
