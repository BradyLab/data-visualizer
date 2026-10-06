// Routes for Datasets, mounted at /datasets in index.ts
import { Router } from "express";
import * as controller from "@src/controllers/dataset.ts";
import { optionalAuth, requireAuth, requireRole } from "@src/middleware/auth.ts";
import { UserRoles } from "@commons/user.ts";

// Express router for the dataset CRUD endpoints
const router = Router();

// Request flow: router (who is calling) -> controller (HTTP in/out, per-dataset access checks) -> service (database)

// Reads are open to guests: optionalAuth identifies the caller (or leaves them as a guest) and the controller shows
// only the datasets they may see (PUBLIC ones for guests, see services/access.ts)
router.get("/", optionalAuth, controller.list);
// Only admins and lab members may create datasets
router.post("/", requireAuth, requireRole(UserRoles.ADMIN, UserRoles.LAB_MEMBER), controller.create);
// Must be registered before "/:id" or "byURL" would be treated as an id
router.get("/byURL/:url", optionalAuth, controller.getByUrl);
router.get("/:id", optionalAuth, controller.get);
// Update needs EDIT access and delete needs OWNER access on the dataset, checked in the controller
router.put("/:id", requireAuth, controller.update);
router.delete("/:id", requireAuth, controller.remove);

export default router;
