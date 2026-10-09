// Routes for Permissions, mounted at /permissions in index.ts (identified by user id + dataset id)
import { Router } from "express";
import * as controller from "@src/controllers/permission.ts";
import { requireAuth, requireRole, requireSelfOrAdmin } from "@src/middleware/auth.ts";
import { UserRoles } from "@commons/user.ts";

// Express router for the permission CRUD endpoints
const router = Router();

// Who a dataset is shared with is visible and editable only to its owner and admins (checked in the controller);
// every route needs a login

// Listing every permission is admin-only
router.get("/", requireAuth, requireRole(UserRoles.ADMIN), controller.list);

// Any logged-in user may call this; the controller requires OWNER access to the dataset
router.post("/", requireAuth, controller.create);

// Must be registered before "/:userId/:datasetId", which would otherwise match "/byUser/<id>" and "/byDataset/<id>"
router.get("/byUser/:userId", requireAuth, requireSelfOrAdmin("userId"), controller.listByUser);

// OWNER access to the dataset is checked in the controller
router.get("/byDataset/:datasetId", requireAuth, controller.listByDataset);

// A user may read their own permission; otherwise the controller needs OWNER access. Update and delete need OWNER access
router.get("/:userId/:datasetId", requireAuth, controller.get);
router.put("/:userId/:datasetId", requireAuth, controller.update);
router.delete("/:userId/:datasetId", requireAuth, controller.remove);

export default router;
