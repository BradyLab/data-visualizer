// Routes for Users, mounted at /users in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/user.ts";
import { requireAuth, requireRole, requireSelfOrAdmin } from "@src/middleware/auth.ts";
import { UserRoles } from "@commons/user.ts";

// Express router for the user CRUD endpoints
const router = Router();

// Every route needs a login; managing users (list, invite, delete, and editing anyone but yourself) is admin-only

router.get("/", requireAuth, requireRole(UserRoles.ADMIN), controller.list);

// Must be registered before "/:id" or "names" would be treated as an id
// Names only, for admins and lab members (e.g. the dataset owner dropdown); external users cannot list lab members
router.get("/names", requireAuth, requireRole(UserRoles.ADMIN, UserRoles.LAB_MEMBER), controller.listNames);
router.post("/", requireAuth, requireRole(UserRoles.ADMIN), controller.create);

// A user may read their own record
router.get("/:id", requireAuth, requireSelfOrAdmin("id"), controller.get);

// Admins edit anyone; a user may edit themselves, but the controller limits them to changing their name (not email, role or status)
router.put("/:id", requireAuth, requireSelfOrAdmin("id"), controller.update);
router.delete("/:id", requireAuth, requireRole(UserRoles.ADMIN), controller.remove);

export default router;
